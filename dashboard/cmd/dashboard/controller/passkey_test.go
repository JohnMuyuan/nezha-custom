package controller

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/patrickmn/go-cache"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

func setupPasskeyTestEnv(t *testing.T) *model.User {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.PasskeyCredential{}, &model.TrustedDevice{}, &model.WAF{}))

	origDB := singleton.DB
	origCache := singleton.Cache
	origConf := singleton.Conf
	singleton.DB = db
	singleton.Cache = cache.New(5*time.Minute, 10*time.Minute)
	singleton.Conf = &singleton.ConfigClass{
		Config: &model.Config{
			ConfigForGuests: model.ConfigForGuests{SiteName: "NezhaTest"},
			ConfigDashboard: model.ConfigDashboard{DashboardHost: "nzzz.yp.fyi"},
			JWTSecretKey:    "test-secret-key-for-passkey-unit-tests-123456",
			JWTTimeout:      24,
		},
	}
	t.Cleanup(func() {
		singleton.DB = origDB
		singleton.Cache = origCache
		singleton.Conf = origConf
	})

	admin := &model.User{
		Username: "admin",
		Role:     model.RoleAdmin,
		Password: "hashed-password",
	}
	require.NoError(t, db.Create(admin).Error)
	return admin
}

func TestPasskeyPolicyAndSingleAdminGuardrails(t *testing.T) {
	admin := setupPasskeyTestEnv(t)

	// 1. Single-admin disables createUser & batchDeleteUser & OAuth2
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/user", nil)
	_, err := createUser(c)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "单管理员模式")

	_, err = batchDeleteUser(c)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "单管理员模式")

	_, err = oauth2redirect(c)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "OAuth2")

	// 2. Cannot enable passkey_only before registering at least 1 passkey
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/profile/auth-policy", bytes.NewBufferString(`{"passkey_only":true}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(model.CtxKeyAuthorizedUser, admin)
	_, err = updateAuthPolicy(c)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "至少绑定 1 把 Passkey")
	assert.False(t, isPasskeyOnlyActive())

	// 3. Insert one Passkey credential -> enabling passkey_only succeeds
	credID := base64.RawURLEncoding.EncodeToString([]byte("cred-key-1"))
	require.NoError(t, singleton.DB.Create(&model.PasskeyCredential{
		UserID:       admin.ID,
		CredentialID: credID,
		PublicKey:    []byte{1, 2, 3},
		AAGUID:       "00000000-0000-0000-0000-000000000000",
		Name:         "My MacBook",
	}).Error)

	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/profile/auth-policy", bytes.NewBufferString(`{"passkey_only":true}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(model.CtxKeyAuthorizedUser, admin)
	pol, err := updateAuthPolicy(c)
	require.NoError(t, err)
	assert.True(t, pol.PasskeyOnly)
	assert.False(t, pol.PasswordLoginEnabled)
	assert.False(t, pol.OAuth2Enabled)
	assert.True(t, isPasskeyOnlyActive())

	// 4. Cannot delete the last passkey while passkey_only is enabled
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: credID}}
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/v1/profile/passkeys/"+credID, nil)
	c.Set(model.CtxKeyAuthorizedUser, admin)
	_, err = deletePasskey(c)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "不能删除最后一把 Passkey")

	// 5. Emergency break-glass env var unlocks password login without altering DB
	t.Setenv(emergencyAllowPasswordEnvKey, "1")
	assert.False(t, isPasskeyOnlyActive())
	pol2, err := getAuthPolicy(c)
	require.NoError(t, err)
	assert.True(t, pol2.EmergencyPasswordOverride)
	assert.True(t, pol2.PasswordLoginEnabled)
}

func TestTrustedDevice180DayLifecycleAndRevocation(t *testing.T) {
	admin := setupPasskeyTestEnv(t)

	// Issue trusted device on initial login
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "https://nzzz.yp.fyi/api/v1/passkey/login/totp", nil)
	c.Request.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/135.0.0.0")
	c.Request.Header.Set("X-Forwarded-Proto", "https")
	c.Set(model.CtxKeyRealIPStr, "203.0.113.10")

	require.NoError(t, grantOrRefreshTrustedDevice(c, admin))
	cookies := w.Result().Cookies()
	var trustCookie *http.Cookie
	for _, ck := range cookies {
		if ck.Name == trustedDeviceCookieName {
			trustCookie = ck
			break
		}
	}
	require.NotNil(t, trustCookie, "must set HttpOnly nz-trusted-device cookie")
	assert.True(t, trustCookie.HttpOnly)
	assert.True(t, trustCookie.Secure)
	assert.Equal(t, trustedDeviceMaxAgeSeconds, trustCookie.MaxAge)

	// Verify old device recognition with that cookie
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Request = httptest.NewRequest(http.MethodPost, "https://nzzz.yp.fyi/api/v1/passkey/login/finish", nil)
	c2.Request.AddCookie(trustCookie)
	dev, raw := findValidTrustedDevice(c2, admin.ID, time.Now())
	require.NotNil(t, dev)
	assert.Equal(t, trustCookie.Value, raw)
	assert.Equal(t, "Chrome · Windows", dev.DeviceName)
	assert.InDelta(t, 180.0, time.Until(dev.ExpiresAt).Hours()/24.0, 0.2)

	// List trusted devices marks current browser as IsCurrent=true
	c2.Set(model.CtxKeyAuthorizedUser, admin)
	list, err := listTrustedDevices(c2)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.True(t, list[0].IsCurrent)

	// Revoke this trusted device -> subsequent login treats it as a new (untrusted) device
	w3 := httptest.NewRecorder()
	c3, _ := gin.CreateTestContext(w3)
	c3.Params = gin.Params{{Key: "id", Value: "1"}}
	c3.Request = httptest.NewRequest(http.MethodDelete, "/api/v1/profile/trusted-devices/1", nil)
	c3.Request.AddCookie(trustCookie)
	c3.Set(model.CtxKeyAuthorizedUser, admin)
	_, err = revokeTrustedDevice(c3)
	require.NoError(t, err)

	devAfter, _ := findValidTrustedDevice(c2, admin.ID, time.Now())
	assert.Nil(t, devAfter, "revoked device must no longer bypass 2FA")
}

func TestPasskeyBeginReturnsServerRPIDAndBase64URLUserHandle(t *testing.T) {
	admin := setupPasskeyTestEnv(t)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "https://nzzz.yp.fyi/api/v1/profile/passkey/register/begin", nil)
	c.Request.Host = "nzzz.yp.fyi"
	c.Request.Header.Set("X-Forwarded-Proto", "https")
	c.Set(model.CtxKeyAuthorizedUser, admin)

	regResp, err := passkeyRegisterBegin(c)
	require.NoError(t, err)
	assert.Equal(t, "nzzz.yp.fyi", regResp.RPID)
	assert.NotEmpty(t, regResp.ChallengeID)

	rawJSON, err := json.Marshal(regResp.PublicKey)
	require.NoError(t, err)
	assert.Contains(t, string(rawJSON), `"nzzz.yp.fyi"`)

	// Check login begin (discoverable credentials)
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Request = httptest.NewRequest(http.MethodPost, "https://nzzz.yp.fyi/api/v1/passkey/login/begin", nil)
	c2.Request.Host = "nzzz.yp.fyi"
	c2.Request.Header.Set("Origin", "https://nzzz.yp.fyi")
	c2.Request.Header.Set("X-Forwarded-Proto", "https")
	loginResp, err := passkeyLoginBegin(c2)
	require.NoError(t, err)
	assert.Equal(t, "nzzz.yp.fyi", loginResp.RPID)
	assert.NotEmpty(t, loginResp.ChallengeID)
}
