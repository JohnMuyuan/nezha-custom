package controller

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"gorm.io/gorm"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/utils"
	"github.com/nezhahq/nezha/service/singleton"
)

const (
	trustedDeviceCookieName      = "nz-trusted-device"
	trustedDeviceTTL             = 180 * 24 * time.Hour
	trustedDeviceMaxAgeSeconds   = 180 * 24 * 60 * 60
	passkeyChallengeTTL          = 5 * time.Minute
	passkeyPendingTOTPTokenTTL   = 5 * time.Minute
	emergencyAllowPasswordEnvKey = "NZ_EMERGENCY_ALLOW_PASSWORD"

	cacheKeyPasskeyRegPrefix   = "passkey:reg:"
	cacheKeyPasskeyLoginPrefix = "passkey:login:"
	cacheKeyPasskeyTOTPPrefix  = "passkey:totp:"
	ctxKeyPasskeyOnlyBlocked   = "nz_passkey_only_blocked"
)

var (
	errPasskeyNotFound = errors.New("passkey credential not found")
	errPasskeyOnly     = errors.New("ApiErrorPasskeyOnly")

	passkeyCacheConsumeMu sync.Mutex
)

// passkeyWebAuthnUser adapts model.User + persisted PasskeyCredentials to go-webauthn's webauthn.User interface.
type passkeyWebAuthnUser struct {
	user        *model.User
	userHandle  []byte
	credentials []webauthn.Credential
}

func (u *passkeyWebAuthnUser) WebAuthnID() []byte                         { return u.userHandle }
func (u *passkeyWebAuthnUser) WebAuthnName() string                       { return u.user.Username }
func (u *passkeyWebAuthnUser) WebAuthnDisplayName() string                { return u.user.Username }
func (u *passkeyWebAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

type cachedPasskeyRegSession struct {
	UserID  uint64
	RPID    string
	Session webauthn.SessionData
}

type cachedPasskeyLoginSession struct {
	RPID    string
	Session webauthn.SessionData
}

type cachedPasskeyPendingTOTP struct {
	UserID       uint64
	Username     string
	CredentialID string
	IP           string
}

type authPolicyResponse struct {
	SingleAdmin               bool   `json:"single_admin"`
	PasskeyAvailable          bool   `json:"passkey_available"`
	PasskeyOnly               bool   `json:"passkey_only"`
	PasswordLoginEnabled      bool   `json:"password_login_enabled"`
	OAuth2Enabled             bool   `json:"oauth2_enabled"`
	EmergencyPasswordOverride bool   `json:"emergency_password_override"`
	RPID                      string `json:"rp_id"`
}

type passkeyListResponse struct {
	RPID                      string                        `json:"rp_id"`
	UserID                    string                        `json:"user_id"`
	Username                  string                        `json:"username"`
	PasskeyOnly               bool                          `json:"passkey_only"`
	EmergencyPasswordOverride bool                          `json:"emergency_password_override"`
	Credentials               []model.PasskeyCredentialView `json:"credentials"`
}

type passkeyBeginResponse struct {
	ChallengeID string `json:"challenge_id"`
	RPID        string `json:"rp_id"`
	PublicKey   any    `json:"publicKey"`
}

type passkeyRegisterFinishForm struct {
	ChallengeID string          `json:"challenge_id"`
	Name        string          `json:"name"`
	Credential  json.RawMessage `json:"credential"`
}

type passkeyLoginFinishForm struct {
	ChallengeID string          `json:"challenge_id"`
	Credential  json.RawMessage `json:"credential"`
}

type passkeyLoginFinishResponse struct {
	OK            bool   `json:"ok"`
	TrustedDevice bool   `json:"trusted_device"`
	TOTPRequired  bool   `json:"totp_required"`
	PendingToken  string `json:"pending_token,omitempty"`
	Username      string `json:"username,omitempty"`
	Token         string `json:"token,omitempty"`
	Expire        string `json:"expire,omitempty"`
}

type passkeyLoginTOTPForm struct {
	PendingToken string `json:"pending_token"`
	TOTPCode     string `json:"totp_code"`
}

type passkeyRenameForm struct {
	Name string `json:"name"`
}

type authPolicyUpdateForm struct {
	PasskeyOnly bool `json:"passkey_only"`
}

func isEmergencyPasswordOverride() bool {
	v := strings.TrimSpace(os.Getenv(emergencyAllowPasswordEnvKey))
	return v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
}

// isPasskeyOnlyActive reports whether password login is locked out right now.
// Safeguard: requires both PasskeyOnly=true on an admin AND >=1 registered credential in DB,
// AND emergency env override not set, so the admin can never be permanently bricked out.
func isPasskeyOnlyActive() bool {
	if isEmergencyPasswordOverride() || singleton.DB == nil {
		return false
	}
	var admin model.User
	if err := singleton.DB.Where("role = ? AND passkey_only = ?", model.RoleAdmin, true).First(&admin).Error; err != nil {
		return false
	}
	var count int64
	if err := singleton.DB.Model(&model.PasskeyCredential{}).Where("user_id = ?", admin.ID).Count(&count).Error; err != nil {
		return false
	}
	return count > 0
}

func countAdminPasskeys() int64 {
	if singleton.DB == nil {
		return 0
	}
	var count int64
	_ = singleton.DB.Model(&model.PasskeyCredential{}).
		Joins("JOIN users ON users.id = passkey_credentials.user_id").
		Where("users.role = ?", model.RoleAdmin).
		Count(&count).Error
	return count
}

func isHTTPSRequest(c *gin.Context) bool {
	if c == nil || c.Request == nil {
		return false
	}
	if c.Request.TLS != nil || strings.EqualFold(c.Request.URL.Scheme, "https") {
		return true
	}
	if strings.EqualFold(c.Request.Header.Get("X-Forwarded-Proto"), "https") {
		return true
	}
	if strings.HasPrefix(strings.ToLower(c.Request.Header.Get("Origin")), "https://") {
		return true
	}
	if strings.HasPrefix(strings.ToLower(c.Request.Referer()), "https://") {
		return true
	}
	return false
}

func stripHostPort(host string) string {
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	// Strip brackets for bare IPv6
	return strings.Trim(host, "[]")
}

// resolveWebAuthnRP resolves RPID, permitted RPOrigins, and RPDisplayName strictly on the server.
// Clients read rp_id from server responses instead of deriving it from window.location.hostname.
func resolveWebAuthnRP(c *gin.Context) (rpID string, rpOrigins []string, rpDisplayName string) {
	rpDisplayName = "Nezha Monitoring"
	if singleton.Conf != nil && strings.TrimSpace(singleton.Conf.SiteName) != "" {
		rpDisplayName = strings.TrimSpace(singleton.Conf.SiteName)
	}

	reqHost := ""
	if c != nil && c.Request != nil {
		reqHost = strings.TrimSpace(c.Request.Host)
	}
	configHost := ""
	if singleton.Conf != nil {
		policy := singleton.Conf.NATDomainPolicySnapshot()
		if policy.DashboardHost != "" {
			configHost = strings.TrimSpace(policy.DashboardHost)
		}
	}

	effectiveHost := reqHost
	if configHost != "" && (reqHost == "" || (singleton.Conf != nil && !singleton.Conf.NATDomainPolicySnapshot().IsReservedHost(reqHost))) {
		effectiveHost = configHost
	}
	if effectiveHost == "" {
		effectiveHost = "localhost"
	}

	rpID = strings.ToLower(stripHostPort(effectiveHost))
	scheme := "http"
	if isHTTPSRequest(c) {
		scheme = "https"
	}

	originSet := make(map[string]struct{})
	addOrigin := func(s, h string) {
		if h == "" {
			return
		}
		originSet[s+"://"+h] = struct{}{}
	}
	addOrigin(scheme, effectiveHost)
	if reqHost != "" && !strings.EqualFold(reqHost, effectiveHost) {
		addOrigin(scheme, reqHost)
	}
	// Also accept explicit https origin if reverse proxy strips TLS header on internal hop
	if rpID != "localhost" && rpID != "127.0.0.1" {
		addOrigin("https", effectiveHost)
		if reqHost != "" {
			addOrigin("https", reqHost)
		}
	}

	rpOrigins = make([]string, 0, len(originSet))
	for o := range originSet {
		rpOrigins = append(rpOrigins, o)
	}
	return rpID, rpOrigins, rpDisplayName
}

func newWebAuthnForRequest(c *gin.Context) (*webauthn.WebAuthn, string, error) {
	rpID, rpOrigins, rpDisplayName := resolveWebAuthnRP(c)
	w, err := webauthn.New(&webauthn.Config{
		RPID:                              rpID,
		RPDisplayName:                     rpDisplayName,
		RPOrigins:                         rpOrigins,
		AttestationPreference:             protocol.PreferNoAttestation,
		ExtensionsUnsolicitedOutputPolicy: protocol.UnsolicitedOutputPolicyIgnore,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			RequireResidentKey: protocol.ResidentKeyRequired(),
			UserVerification:   protocol.VerificationPreferred,
		},
	})
	if err != nil {
		return nil, rpID, err
	}
	return w, rpID, nil
}

// ensurePasskeyUserHandle lazily creates and persists a 32-byte random unpadded Base64URL WebAuthn user handle.
func ensurePasskeyUserHandle(user *model.User) (string, []byte, error) {
	if user == nil {
		return "", nil, errors.New("user is nil")
	}
	if strings.TrimSpace(user.PasskeyUserHandle) != "" {
		raw, err := base64.RawURLEncoding.DecodeString(user.PasskeyUserHandle)
		if err == nil && len(raw) >= 16 {
			return user.PasskeyUserHandle, raw, nil
		}
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	if singleton.DB != nil {
		if err := singleton.DB.Model(&model.User{}).Where("id = ?", user.ID).Update("passkey_user_handle", encoded).Error; err != nil {
			return "", nil, err
		}
	}
	user.PasskeyUserHandle = encoded
	return encoded, raw, nil
}

func loadWebAuthnUser(user *model.User) (*passkeyWebAuthnUser, []model.PasskeyCredential, error) {
	_, rawHandle, err := ensurePasskeyUserHandle(user)
	if err != nil {
		return nil, nil, err
	}
	var rows []model.PasskeyCredential
	if err := singleton.DB.Where("user_id = ?", user.ID).Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	creds := make([]webauthn.Credential, 0, len(rows))
	for i := range rows {
		c, convErr := rows[i].ToWebAuthnCredential()
		if convErr != nil {
			continue
		}
		creds = append(creds, c)
	}
	return &passkeyWebAuthnUser{
		user:        user,
		userHandle:  rawHandle,
		credentials: creds,
	}, rows, nil
}

func hashTrustedDeviceToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func friendlyDeviceNameFromUA(ua string) string {
	lower := strings.ToLower(ua)
	browser := "浏览器"
	switch {
	case strings.Contains(lower, "edg/"):
		browser = "Edge"
	case strings.Contains(lower, "chrome/") && !strings.Contains(lower, "edg/"):
		browser = "Chrome"
	case strings.Contains(lower, "firefox/"):
		browser = "Firefox"
	case strings.Contains(lower, "safari/") && !strings.Contains(lower, "chrome/"):
		browser = "Safari"
	}
	osName := "未知设备"
	switch {
	case strings.Contains(lower, "iphone"):
		osName = "iPhone"
	case strings.Contains(lower, "ipad"):
		osName = "iPad"
	case strings.Contains(lower, "android"):
		osName = "Android"
	case strings.Contains(lower, "windows"):
		osName = "Windows"
	case strings.Contains(lower, "mac os x") || strings.Contains(lower, "macintosh"):
		osName = "macOS"
	case strings.Contains(lower, "linux"):
		osName = "Linux"
	}
	return fmt.Sprintf("%s · %s", browser, osName)
}

func setTrustedDeviceCookie(c *gin.Context, rawToken string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(trustedDeviceCookieName, rawToken, trustedDeviceMaxAgeSeconds, "/", "", isHTTPSRequest(c), true)
}

func clearTrustedDeviceCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(trustedDeviceCookieName, "", -1, "/", "", isHTTPSRequest(c), true)
}

func findValidTrustedDevice(c *gin.Context, userID uint64, now time.Time) (*model.TrustedDevice, string) {
	rawToken, err := c.Cookie(trustedDeviceCookieName)
	if err != nil || strings.TrimSpace(rawToken) == "" {
		return nil, ""
	}
	tokenHash := hashTrustedDeviceToken(rawToken)
	var dev model.TrustedDevice
	if err := singleton.DB.Where("user_id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ?", userID, tokenHash, now).
		First(&dev).Error; err != nil {
		return nil, ""
	}
	return &dev, rawToken
}

func grantOrRefreshTrustedDevice(c *gin.Context, user *model.User) error {
	if c == nil || user == nil || singleton.DB == nil {
		return nil
	}
	now := time.Now()
	realIP := c.GetString(model.CtxKeyRealIPStr)
	ua := c.Request.UserAgent()
	if len(ua) > 500 {
		ua = ua[:500]
	}

	if existing, rawToken := findValidTrustedDevice(c, user.ID, now); existing != nil {
		nextExp := now.Add(trustedDeviceTTL)
		_ = singleton.DB.Model(&model.TrustedDevice{}).Where("id = ?", existing.ID).Updates(map[string]any{
			"last_used_at": now,
			"last_ip":      realIP,
			"expires_at":   nextExp,
		}).Error
		setTrustedDeviceCookie(c, rawToken)
		return nil
	}

	rawBytes := make([]byte, 32)
	if _, err := rand.Read(rawBytes); err != nil {
		return err
	}
	rawToken := base64.RawURLEncoding.EncodeToString(rawBytes)
	dev := model.TrustedDevice{
		UserID:     user.ID,
		TokenHash:  hashTrustedDeviceToken(rawToken),
		DeviceName: friendlyDeviceNameFromUA(ua),
		UserAgent:  ua,
		LastIP:     realIP,
		ExpiresAt:  now.Add(trustedDeviceTTL),
		LastUsedAt: now,
		CreatedAt:  now,
	}
	if err := singleton.DB.Create(&dev).Error; err != nil {
		return err
	}
	setTrustedDeviceCookie(c, rawToken)
	return nil
}

// GET /api/v1/auth/policy
func getAuthPolicy(c *gin.Context) (authPolicyResponse, error) {
	rpID, _, _ := resolveWebAuthnRP(c)
	passkeyCount := countAdminPasskeys()
	passkeyOnly := isPasskeyOnlyActive()
	return authPolicyResponse{
		SingleAdmin:               true,
		PasskeyAvailable:          passkeyCount > 0,
		PasskeyOnly:               passkeyOnly,
		PasswordLoginEnabled:      !passkeyOnly,
		OAuth2Enabled:             false,
		EmergencyPasswordOverride: isEmergencyPasswordOverride(),
		RPID:                      rpID,
	}, nil
}

// GET /api/v1/profile/passkeys
func listPasskeys(c *gin.Context) (passkeyListResponse, error) {
	auth, ok := c.Get(model.CtxKeyAuthorizedUser)
	if !ok {
		return passkeyListResponse{}, singleton.Localizer.ErrorT("unauthorized")
	}
	user := auth.(*model.User)
	var fresh model.User
	if err := singleton.DB.First(&fresh, user.ID).Error; err != nil {
		return passkeyListResponse{}, err
	}
	userHandle, _, err := ensurePasskeyUserHandle(&fresh)
	if err != nil {
		return passkeyListResponse{}, err
	}
	var rows []model.PasskeyCredential
	if err := singleton.DB.Where("user_id = ?", fresh.ID).Order("created_at DESC").Find(&rows).Error; err != nil {
		return passkeyListResponse{}, newGormError("%v", err)
	}
	views := make([]model.PasskeyCredentialView, 0, len(rows))
	for i := range rows {
		views = append(views, rows[i].ToView())
	}
	rpID, _, _ := resolveWebAuthnRP(c)
	return passkeyListResponse{
		RPID:                      rpID,
		UserID:                    userHandle,
		Username:                  fresh.Username,
		PasskeyOnly:               fresh.PasskeyOnly,
		EmergencyPasswordOverride: isEmergencyPasswordOverride(),
		Credentials:               views,
	}, nil
}

// POST /api/v1/profile/passkey/register/begin
func passkeyRegisterBegin(c *gin.Context) (passkeyBeginResponse, error) {
	auth, ok := c.Get(model.CtxKeyAuthorizedUser)
	if !ok {
		return passkeyBeginResponse{}, singleton.Localizer.ErrorT("unauthorized")
	}
	user := auth.(*model.User)
	var fresh model.User
	if err := singleton.DB.First(&fresh, user.ID).Error; err != nil {
		return passkeyBeginResponse{}, err
	}
	if !fresh.Role.IsAdmin() {
		return passkeyBeginResponse{}, singleton.Localizer.ErrorT("permission denied")
	}

	w, rpID, err := newWebAuthnForRequest(c)
	if err != nil {
		return passkeyBeginResponse{}, err
	}
	webUser, _, err := loadWebAuthnUser(&fresh)
	if err != nil {
		return passkeyBeginResponse{}, err
	}

	exclusions := make([]protocol.CredentialDescriptor, 0, len(webUser.credentials))
	for _, cred := range webUser.credentials {
		exclusions = append(exclusions, cred.Descriptor())
	}

	creation, sessionData, err := w.BeginRegistration(
		webUser,
		webauthn.WithExclusions(exclusions),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			RequireResidentKey: protocol.ResidentKeyRequired(),
			UserVerification:   protocol.VerificationPreferred,
		}),
	)
	if err != nil {
		return passkeyBeginResponse{}, err
	}

	challengeID, err := utils.GenerateRandomString(32)
	if err != nil {
		return passkeyBeginResponse{}, err
	}
	singleton.Cache.Set(cacheKeyPasskeyRegPrefix+challengeID, &cachedPasskeyRegSession{
		UserID:  fresh.ID,
		RPID:    rpID,
		Session: *sessionData,
	}, passkeyChallengeTTL)

	return passkeyBeginResponse{
		ChallengeID: challengeID,
		RPID:        rpID,
		PublicKey:   creation.Response,
	}, nil
}

// POST /api/v1/profile/passkey/register/finish
func passkeyRegisterFinish(c *gin.Context) (model.PasskeyCredentialView, error) {
	var form passkeyRegisterFinishForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return model.PasskeyCredentialView{}, err
	}
	auth, ok := c.Get(model.CtxKeyAuthorizedUser)
	if !ok {
		return model.PasskeyCredentialView{}, singleton.Localizer.ErrorT("unauthorized")
	}
	user := auth.(*model.User)
	if strings.TrimSpace(form.ChallengeID) == "" || len(form.Credential) == 0 {
		return model.PasskeyCredentialView{}, errors.New("缺少 Passkey 注册凭据或挑战 ID")
	}

	passkeyCacheConsumeMu.Lock()
	rawSess, exists := singleton.Cache.Get(cacheKeyPasskeyRegPrefix + form.ChallengeID)
	if exists {
		singleton.Cache.Delete(cacheKeyPasskeyRegPrefix + form.ChallengeID)
	}
	passkeyCacheConsumeMu.Unlock()
	if !exists {
		return model.PasskeyCredentialView{}, errors.New("Passkey 注册挑战已过期，请重试")
	}
	regSession := rawSess.(*cachedPasskeyRegSession)
	if regSession.UserID != user.ID {
		return model.PasskeyCredentialView{}, singleton.Localizer.ErrorT("permission denied")
	}

	var fresh model.User
	if err := singleton.DB.First(&fresh, user.ID).Error; err != nil {
		return model.PasskeyCredentialView{}, err
	}
	w, _, err := newWebAuthnForRequest(c)
	if err != nil {
		return model.PasskeyCredentialView{}, err
	}
	webUser, _, err := loadWebAuthnUser(&fresh)
	if err != nil {
		return model.PasskeyCredentialView{}, err
	}

	parsed, err := protocol.ParseCredentialCreationResponseBytes(form.Credential)
	if err != nil {
		return model.PasskeyCredentialView{}, fmt.Errorf("无效的 Passkey 注册响应: %w", err)
	}

	cred, err := w.CreateCredential(webUser, regSession.Session, parsed)
	if err != nil {
		return model.PasskeyCredentialView{}, fmt.Errorf("Passkey 验签失败: %w", err)
	}

	credIDB64 := base64.RawURLEncoding.EncodeToString(cred.ID)
	transports := make([]string, 0, len(cred.Transport))
	for _, t := range cred.Transport {
		if string(t) != "" {
			transports = append(transports, string(t))
		}
	}
	transportsJSON, _ := json.Marshal(transports)

	name := strings.TrimSpace(form.Name)
	if name == "" {
		name = friendlyDeviceNameFromUA(c.Request.UserAgent())
	}
	if len(name) > 120 {
		name = name[:120]
	}

	row := model.PasskeyCredential{
		UserID:          fresh.ID,
		CredentialID:    credIDB64,
		PublicKey:       cred.PublicKey,
		AttestationType: cred.AttestationType,
		AAGUID:          model.FormatAAGUID(cred.Authenticator.AAGUID),
		SignCount:       cred.Authenticator.SignCount,
		CloneWarning:    cred.Authenticator.CloneWarning,
		BackupEligible:  cred.Flags.BackupEligible,
		BackupState:     cred.Flags.BackupState,
		TransportsJSON:  string(transportsJSON),
		Name:            name,
	}
	if err := singleton.DB.Create(&row).Error; err != nil {
		return model.PasskeyCredentialView{}, newGormError("%v", err)
	}

	return row.ToView(), nil
}

// PUT /api/v1/profile/passkeys/:id
func renamePasskey(c *gin.Context) (model.PasskeyCredentialView, error) {
	credID := strings.TrimSpace(c.Param("id"))
	var form passkeyRenameForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return model.PasskeyCredentialView{}, err
	}
	name := strings.TrimSpace(form.Name)
	if name == "" || len(name) > 120 {
		return model.PasskeyCredentialView{}, errors.New("Passkey 名称需为 1–120 个字符")
	}
	auth := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)

	var row model.PasskeyCredential
	if err := singleton.DB.Where("user_id = ? AND credential_id = ?", auth.ID, credID).First(&row).Error; err != nil {
		return model.PasskeyCredentialView{}, errors.New("未找到该 Passkey")
	}
	row.Name = name
	if err := singleton.DB.Model(&row).Update("name", name).Error; err != nil {
		return model.PasskeyCredentialView{}, newGormError("%v", err)
	}
	return row.ToView(), nil
}

// DELETE /api/v1/profile/passkeys/:id
func deletePasskey(c *gin.Context) (any, error) {
	credID := strings.TrimSpace(c.Param("id"))
	auth := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)

	var fresh model.User
	if err := singleton.DB.First(&fresh, auth.ID).Error; err != nil {
		return nil, err
	}
	var total int64
	if err := singleton.DB.Model(&model.PasskeyCredential{}).Where("user_id = ?", fresh.ID).Count(&total).Error; err != nil {
		return nil, newGormError("%v", err)
	}
	if fresh.PasskeyOnly && total <= 1 {
		return nil, errors.New("当前已开启「仅限 Passkey 登录」，不能删除最后一把 Passkey（请先新增一把或先关闭仅限 Passkey 开关）")
	}

	res := singleton.DB.Where("user_id = ? AND credential_id = ?", fresh.ID, credID).Delete(&model.PasskeyCredential{})
	if res.Error != nil {
		return nil, newGormError("%v", res.Error)
	}
	if res.RowsAffected == 0 {
		return nil, errors.New("未找到该 Passkey")
	}
	return gin.H{"deleted": true}, nil
}

// PUT /api/v1/profile/auth-policy
func updateAuthPolicy(c *gin.Context) (authPolicyResponse, error) {
	var form authPolicyUpdateForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return authPolicyResponse{}, err
	}
	auth := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)
	var fresh model.User
	if err := singleton.DB.First(&fresh, auth.ID).Error; err != nil {
		return authPolicyResponse{}, err
	}
	if !fresh.Role.IsAdmin() {
		return authPolicyResponse{}, singleton.Localizer.ErrorT("permission denied")
	}

	if form.PasskeyOnly {
		var count int64
		if err := singleton.DB.Model(&model.PasskeyCredential{}).Where("user_id = ?", fresh.ID).Count(&count).Error; err != nil {
			return authPolicyResponse{}, newGormError("%v", err)
		}
		if count < 1 {
			return authPolicyResponse{}, errors.New("请先至少绑定 1 把 Passkey 后，再开启「仅限 Passkey 登录」")
		}
	}

	if err := singleton.DB.Model(&model.User{}).Where("id = ?", fresh.ID).Update("passkey_only", form.PasskeyOnly).Error; err != nil {
		return authPolicyResponse{}, newGormError("%v", err)
	}

	return getAuthPolicy(c)
}

// POST /api/v1/passkey/login/begin
func passkeyLoginBegin(c *gin.Context) (passkeyBeginResponse, error) {
	if !checkSameOrigin(c.Request) || c.GetHeader("Sec-Fetch-Site") == "cross-site" {
		return passkeyBeginResponse{}, errors.New("ApiErrorUnauthorized")
	}
	w, rpID, err := newWebAuthnForRequest(c)
	if err != nil {
		return passkeyBeginResponse{}, err
	}
	assertion, sessionData, err := w.BeginDiscoverableLogin(
		webauthn.WithUserVerification(protocol.VerificationPreferred),
	)
	if err != nil {
		return passkeyBeginResponse{}, err
	}
	challengeID, err := utils.GenerateRandomString(32)
	if err != nil {
		return passkeyBeginResponse{}, err
	}
	singleton.Cache.Set(cacheKeyPasskeyLoginPrefix+challengeID, &cachedPasskeyLoginSession{
		RPID:    rpID,
		Session: *sessionData,
	}, passkeyChallengeTTL)

	return passkeyBeginResponse{
		ChallengeID: challengeID,
		RPID:        rpID,
		PublicKey:   assertion.Response,
	}, nil
}

// POST /api/v1/passkey/login/finish
func passkeyLoginFinish(jwtConfig *jwt.GinJWTMiddleware) func(c *gin.Context) (passkeyLoginFinishResponse, error) {
	return func(c *gin.Context) (passkeyLoginFinishResponse, error) {
		if !checkSameOrigin(c.Request) || c.GetHeader("Sec-Fetch-Site") == "cross-site" {
			return passkeyLoginFinishResponse{}, errors.New("ApiErrorUnauthorized")
		}
		var form passkeyLoginFinishForm
		if err := c.ShouldBindJSON(&form); err != nil {
			return passkeyLoginFinishResponse{}, err
		}
		if strings.TrimSpace(form.ChallengeID) == "" || len(form.Credential) == 0 {
			return passkeyLoginFinishResponse{}, errors.New("缺少 Passkey 认证响应")
		}

		passkeyCacheConsumeMu.Lock()
		rawSess, exists := singleton.Cache.Get(cacheKeyPasskeyLoginPrefix + form.ChallengeID)
		if exists {
			singleton.Cache.Delete(cacheKeyPasskeyLoginPrefix + form.ChallengeID)
		}
		passkeyCacheConsumeMu.Unlock()
		if !exists {
			return passkeyLoginFinishResponse{}, errors.New("Passkey 登录挑战已过期，请重试")
		}
		loginSession := rawSess.(*cachedPasskeyLoginSession)

		w, _, err := newWebAuthnForRequest(c)
		if err != nil {
			return passkeyLoginFinishResponse{}, err
		}
		parsed, err := protocol.ParseCredentialRequestResponseBytes(form.Credential)
		if err != nil {
			return passkeyLoginFinishResponse{}, fmt.Errorf("无效的 Passkey 登录响应: %w", err)
		}

		var matchedUser model.User
		var matchedRow model.PasskeyCredential
		discoverableHandler := func(rawID, userHandle []byte) (webauthn.User, error) {
			credIDB64 := base64.RawURLEncoding.EncodeToString(rawID)
			var row model.PasskeyCredential
			if err := singleton.DB.Where("credential_id = ?", credIDB64).First(&row).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return nil, errPasskeyNotFound
				}
				return nil, err
			}
			var u model.User
			if err := singleton.DB.First(&u, row.UserID).Error; err != nil {
				return nil, errPasskeyNotFound
			}
			// Single-admin invariant: only admin accounts may authenticate.
			if !u.Role.IsAdmin() {
				return nil, errPasskeyNotFound
			}
			// If authenticator supplied a userHandle, verify it matches the owner's handle.
			if len(userHandle) > 0 && u.PasskeyUserHandle != "" {
				if base64.RawURLEncoding.EncodeToString(userHandle) != u.PasskeyUserHandle {
					return nil, errPasskeyNotFound
				}
			}
			matchedUser = u
			matchedRow = row
			webUser, _, err := loadWebAuthnUser(&u)
			if err != nil {
				return nil, err
			}
			return webUser, nil
		}

		realIP := c.GetString(model.CtxKeyRealIPStr)
		_, validatedCred, err := w.ValidatePasskeyLogin(discoverableHandler, loginSession.Session, parsed)
		if err != nil {
			if errors.Is(err, errPasskeyNotFound) {
				// Return explicit HTTP 404 per WebAuthn passkey-authentication guide
				// so client can safely call PublicKeyCredential.signalUnknownCredential().
				c.JSON(http.StatusNotFound, model.CommonResponse[any]{
					Success: false,
					Error:   "ApiErrorPasskeyNotFound",
				})
				return passkeyLoginFinishResponse{}, errNoop
			}
			model.BlockIP(singleton.DB, realIP, model.WAFBlockReasonTypeLoginFail, model.BlockIDUnknownUser)
			return passkeyLoginFinishResponse{}, fmt.Errorf("Passkey 验证失败: %w", err)
		}

		now := time.Now()
		_ = singleton.DB.Model(&model.PasskeyCredential{}).Where("id = ?", matchedRow.ID).Updates(map[string]any{
			"sign_count":    validatedCred.Authenticator.SignCount,
			"clone_warning": validatedCred.Authenticator.CloneWarning,
			"backup_state":  validatedCred.Flags.BackupState,
			"last_used_at":  now,
		}).Error

		model.UnblockIP(singleton.DB, realIP, model.BlockIDUnknownUser)
		model.UnblockIP(singleton.DB, realIP, int64(matchedUser.ID))

		// Trusted (old) device check: if this browser already has a valid 180-day trusted-device cookie,
		// skip 2FA and log in directly (auto-extending trust for another 180 days).
		// New / untrusted devices require 6-digit TOTP when 2FA is enabled.
		trustedDev, _ := findValidTrustedDevice(c, matchedUser.ID, now)
		if matchedUser.TOTPEnabled && strings.TrimSpace(matchedUser.TOTPSecret) != "" && trustedDev == nil {
			pendingToken, err := utils.GenerateRandomString(32)
			if err != nil {
				return passkeyLoginFinishResponse{}, err
			}
			singleton.Cache.Set(cacheKeyPasskeyTOTPPrefix+pendingToken, &cachedPasskeyPendingTOTP{
				UserID:       matchedUser.ID,
				Username:     matchedUser.Username,
				CredentialID: matchedRow.CredentialID,
				IP:           realIP,
			}, passkeyPendingTOTPTokenTTL)
			return passkeyLoginFinishResponse{
				OK:            false,
				TrustedDevice: false,
				TOTPRequired:  true,
				PendingToken:  pendingToken,
				Username:      matchedUser.Username,
			}, nil
		}

		// Old trusted device (or 2FA disabled): extend/grant device trust & issue JWT session.
		_ = grantOrRefreshTrustedDevice(c, &matchedUser)
		tokenString, expire, err := issueAndSetJWTCookies(c, jwtConfig, &matchedUser)
		if err != nil {
			return passkeyLoginFinishResponse{}, err
		}
		return passkeyLoginFinishResponse{
			OK:            true,
			TrustedDevice: trustedDev != nil,
			TOTPRequired:  false,
			Username:      matchedUser.Username,
			Token:         tokenString,
			Expire:        expire.Format(time.RFC3339),
		}, nil
	}
}

// POST /api/v1/passkey/login/totp
func passkeyLoginTOTP(jwtConfig *jwt.GinJWTMiddleware) func(c *gin.Context) (passkeyLoginFinishResponse, error) {
	return func(c *gin.Context) (passkeyLoginFinishResponse, error) {
		if !checkSameOrigin(c.Request) || c.GetHeader("Sec-Fetch-Site") == "cross-site" {
			return passkeyLoginFinishResponse{}, errors.New("ApiErrorUnauthorized")
		}
		var form passkeyLoginTOTPForm
		if err := c.ShouldBindJSON(&form); err != nil {
			return passkeyLoginFinishResponse{}, err
		}
		tokenKey := strings.TrimSpace(form.PendingToken)
		code := strings.TrimSpace(form.TOTPCode)
		if tokenKey == "" || code == "" {
			return passkeyLoginFinishResponse{}, errors.New("请输入 6 位动态验证码或应急恢复码")
		}

		rawPending, exists := singleton.Cache.Get(cacheKeyPasskeyTOTPPrefix + tokenKey)
		if !exists {
			return passkeyLoginFinishResponse{}, errors.New("验证会话已过期，请重新使用 Passkey 登录")
		}
		pending := rawPending.(*cachedPasskeyPendingTOTP)

		var user model.User
		if err := singleton.DB.First(&user, pending.UserID).Error; err != nil || !user.Role.IsAdmin() {
			return passkeyLoginFinishResponse{}, errors.New("ApiErrorUnauthorized")
		}

		realIP := c.GetString(model.CtxKeyRealIPStr)
		if !verifyUserTOTPOrRecoveryCode(&user, code) {
			model.BlockIP(singleton.DB, realIP, model.WAFBlockReasonTypeLoginFail, int64(user.ID))
			return passkeyLoginFinishResponse{}, errTOTPInvalid
		}

		singleton.Cache.Delete(cacheKeyPasskeyTOTPPrefix + tokenKey)
		model.UnblockIP(singleton.DB, realIP, int64(user.ID))

		// New device passed Passkey + 2FA -> mark as trusted device for 180 days!
		_ = grantOrRefreshTrustedDevice(c, &user)

		tokenString, expire, err := issueAndSetJWTCookies(c, jwtConfig, &user)
		if err != nil {
			return passkeyLoginFinishResponse{}, err
		}
		return passkeyLoginFinishResponse{
			OK:            true,
			TrustedDevice: true,
			TOTPRequired:  false,
			Username:      user.Username,
			Token:         tokenString,
			Expire:        expire.Format(time.RFC3339),
		}, nil
	}
}

func issueAndSetJWTCookies(c *gin.Context, jwtConfig *jwt.GinJWTMiddleware, user *model.User) (string, time.Time, error) {
	claims, err := issueJWTSession(c, user, singleton.Conf.JWTTimeout)
	if err != nil {
		return "", time.Time{}, err
	}
	tokenString, expire, err := jwtConfig.TokenGenerator(claims)
	if err != nil {
		return "", time.Time{}, err
	}
	jwtConfig.SetCookie(c, tokenString)
	setCSRFCookie(c)
	return tokenString, expire, nil
}

// GET /api/v1/profile/trusted-devices
func listTrustedDevices(c *gin.Context) ([]model.TrustedDeviceView, error) {
	auth := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)
	now := time.Now()

	currentHash := ""
	if rawCookie, err := c.Cookie(trustedDeviceCookieName); err == nil && strings.TrimSpace(rawCookie) != "" {
		currentHash = hashTrustedDeviceToken(rawCookie)
	}

	var rows []model.TrustedDevice
	if err := singleton.DB.Where("user_id = ? AND revoked_at IS NULL AND expires_at > ?", auth.ID, now).
		Order("last_used_at DESC").Find(&rows).Error; err != nil {
		return nil, newGormError("%v", err)
	}

	views := make([]model.TrustedDeviceView, 0, len(rows))
	for _, r := range rows {
		views = append(views, model.TrustedDeviceView{
			ID:         r.ID,
			DeviceName: r.DeviceName,
			LastIP:     r.LastIP,
			IsCurrent:  currentHash != "" && r.TokenHash == currentHash,
			CreatedAt:  r.CreatedAt.UnixMilli(),
			LastUsedAt: r.LastUsedAt.UnixMilli(),
			ExpiresAt:  r.ExpiresAt.UnixMilli(),
		})
	}
	return views, nil
}

// DELETE /api/v1/profile/trusted-devices/:id
func revokeTrustedDevice(c *gin.Context) (any, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return nil, errors.New("无效的设备 ID")
	}
	auth := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)
	now := time.Now()

	var dev model.TrustedDevice
	if err := singleton.DB.Where("id = ? AND user_id = ? AND revoked_at IS NULL", id, auth.ID).First(&dev).Error; err != nil {
		return nil, errors.New("未找到该受信任设备")
	}
	if err := singleton.DB.Model(&dev).Update("revoked_at", &now).Error; err != nil {
		return nil, newGormError("%v", err)
	}
	if rawCookie, err := c.Cookie(trustedDeviceCookieName); err == nil && hashTrustedDeviceToken(rawCookie) == dev.TokenHash {
		clearTrustedDeviceCookie(c)
	}
	return gin.H{"revoked": true}, nil
}

// DELETE /api/v1/profile/trusted-devices
func revokeAllTrustedDevices(c *gin.Context) (any, error) {
	auth := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)
	keepCurrent := c.Query("keep_current") == "true"
	now := time.Now()

	q := singleton.DB.Model(&model.TrustedDevice{}).Where("user_id = ? AND revoked_at IS NULL", auth.ID)
	if keepCurrent {
		if rawCookie, err := c.Cookie(trustedDeviceCookieName); err == nil && strings.TrimSpace(rawCookie) != "" {
			q = q.Where("token_hash != ?", hashTrustedDeviceToken(rawCookie))
		}
	} else {
		clearTrustedDeviceCookie(c)
	}
	res := q.Update("revoked_at", &now)
	if res.Error != nil {
		return nil, newGormError("%v", res.Error)
	}
	return gin.H{"revoked_count": res.RowsAffected}, nil
}
