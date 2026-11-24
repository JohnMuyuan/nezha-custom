package controller

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/totp"
	"github.com/nezhahq/nezha/service/singleton"
)

const (
	ctxKeyTOTPRequired = "nz_totp_required"
	ctxKeyTOTPInvalid  = "nz_totp_invalid"
)

var (
	errTOTPRequired = errors.New("ApiErrorTOTPRequired")
	errTOTPInvalid  = errors.New("ApiErrorTOTPInvalid")
)

type totpSetupForm struct {
	Password string `json:"password"`
}

type totpSetupResponse struct {
	Secret     string `json:"secret"`
	OTPAuthURI string `json:"otpauth_uri"`
	Issuer     string `json:"issuer"`
	Account    string `json:"account"`
}

type totpEnableForm struct {
	Code string `json:"code"`
}

type totpEnableResponse struct {
	Enabled       bool     `json:"enabled"`
	RecoveryCodes []string `json:"recovery_codes"`
}

type totpDisableForm struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

// verifyUserTOTPOrRecoveryCode validates a 6-digit TOTP code (with atomic replay protection)
// or a single-use emergency recovery code (removing it once consumed).
func verifyUserTOTPOrRecoveryCode(user *model.User, rawCode string) bool {
	if user == nil || !user.TOTPEnabled || strings.TrimSpace(user.TOTPSecret) == "" {
		return false
	}
	code := strings.TrimSpace(rawCode)
	if code == "" {
		return false
	}

	// 1. Try 6-digit RFC 6238 TOTP code first
	if step, ok := totp.Verify(user.TOTPSecret, code, time.Now(), user.TOTPLastUsedStep); ok {
		res := singleton.DB.Model(&model.User{}).
			Where("id = ? AND totp_last_used_step < ?", user.ID, step).
			Update("totp_last_used_step", step)
		if res.Error == nil && res.RowsAffected == 1 {
			user.TOTPLastUsedStep = step
			return true
		}
		return false
	}

	// 2. Fallback: try single-use emergency recovery code (XXXX-XXXX)
	if strings.TrimSpace(user.TOTPRecoveryHashes) == "" {
		return false
	}
	var hashes []string
	if err := json.Unmarshal([]byte(user.TOTPRecoveryHashes), &hashes); err != nil || len(hashes) == 0 {
		return false
	}
	normalized := totp.NormalizeRecoveryCode(code)
	matchedIdx := -1
	for i, h := range hashes {
		if bcrypt.CompareHashAndPassword([]byte(h), []byte(normalized)) == nil {
			matchedIdx = i
			break
		}
	}
	if matchedIdx < 0 {
		return false
	}

	remaining := append(hashes[:matchedIdx], hashes[matchedIdx+1:]...)
	nextBytes, _ := json.Marshal(remaining)
	res := singleton.DB.Model(&model.User{}).
		Where("id = ? AND totp_recovery_hashes = ?", user.ID, user.TOTPRecoveryHashes).
		Update("totp_recovery_hashes", string(nextBytes))
	if res.Error == nil && res.RowsAffected == 1 {
		user.TOTPRecoveryHashes = string(nextBytes)
		return true
	}
	return false
}

// POST /api/v1/profile/2fa/setup
func setupTOTP(c *gin.Context) (totpSetupResponse, error) {
	var form totpSetupForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return totpSetupResponse{}, err
	}
	auth, ok := c.Get(model.CtxKeyAuthorizedUser)
	if !ok {
		return totpSetupResponse{}, singleton.Localizer.ErrorT("unauthorized")
	}
	user := auth.(*model.User)

	var fresh model.User
	if err := singleton.DB.First(&fresh, user.ID).Error; err != nil {
		return totpSetupResponse{}, err
	}
	if fresh.TOTPEnabled {
		return totpSetupResponse{}, errors.New("当前账号已经开启了 2FA，请先关闭后再重新绑定")
	}
	if !fresh.RejectPassword && !fresh.PasskeyOnly && !isPasskeyOnlyActive() {
		if err := bcrypt.CompareHashAndPassword([]byte(fresh.Password), []byte(form.Password)); err != nil {
			return totpSetupResponse{}, errors.New("当前登录密码不正确")
		}
	}

	secret, err := totp.GenerateSecret()
	if err != nil {
		return totpSetupResponse{}, err
	}
	if err := singleton.DB.Model(&model.User{}).Where("id = ?", fresh.ID).Update("totp_pending_secret", secret).Error; err != nil {
		return totpSetupResponse{}, newGormError("%v", err)
	}

	issuer := "Nezha"
	if singleton.Conf != nil && strings.TrimSpace(singleton.Conf.SiteName) != "" {
		issuer = strings.TrimSpace(singleton.Conf.SiteName)
	}
	return totpSetupResponse{
		Secret:     secret,
		OTPAuthURI: totp.BuildOTPAuthURI(issuer, fresh.Username, secret),
		Issuer:     issuer,
		Account:    fresh.Username,
	}, nil
}

// POST /api/v1/profile/2fa/enable
func enableTOTP(c *gin.Context) (totpEnableResponse, error) {
	var form totpEnableForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return totpEnableResponse{}, err
	}
	auth, ok := c.Get(model.CtxKeyAuthorizedUser)
	if !ok {
		return totpEnableResponse{}, singleton.Localizer.ErrorT("unauthorized")
	}
	user := auth.(*model.User)

	var fresh model.User
	if err := singleton.DB.First(&fresh, user.ID).Error; err != nil {
		return totpEnableResponse{}, err
	}
	if strings.TrimSpace(fresh.TOTPPendingSecret) == "" {
		return totpEnableResponse{}, errors.New("请先点击「开始绑定」生成二维码密钥")
	}

	step, valid := totp.Verify(fresh.TOTPPendingSecret, form.Code, time.Now(), 0)
	if !valid {
		return totpEnableResponse{}, errors.New("6 位动态验证码不正确或已过期，请核对手机验证器时间与数字后重试")
	}

	recoveryCodes, err := totp.GenerateRecoveryCodes(8)
	if err != nil {
		return totpEnableResponse{}, err
	}
	hashes := make([]string, 0, len(recoveryCodes))
	for _, rc := range recoveryCodes {
		h, hErr := bcrypt.GenerateFromPassword([]byte(rc), bcrypt.DefaultCost)
		if hErr != nil {
			return totpEnableResponse{}, hErr
		}
		hashes = append(hashes, string(h))
	}
	hashesJSON, _ := json.Marshal(hashes)

	if err := singleton.DB.Model(&model.User{}).Where("id = ?", fresh.ID).Updates(map[string]any{
		"totp_enabled":         true,
		"totp_secret":          fresh.TOTPPendingSecret,
		"totp_pending_secret":  "",
		"totp_recovery_hashes": string(hashesJSON),
		"totp_last_used_step":  step,
	}).Error; err != nil {
		return totpEnableResponse{}, newGormError("%v", err)
	}

	return totpEnableResponse{
		Enabled:       true,
		RecoveryCodes: recoveryCodes,
	}, nil
}

// POST /api/v1/profile/2fa/disable
func disableTOTP(c *gin.Context) (any, error) {
	var form totpDisableForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	auth, ok := c.Get(model.CtxKeyAuthorizedUser)
	if !ok {
		return nil, singleton.Localizer.ErrorT("unauthorized")
	}
	user := auth.(*model.User)

	var fresh model.User
	if err := singleton.DB.First(&fresh, user.ID).Error; err != nil {
		return nil, err
	}
	if !fresh.TOTPEnabled {
		return gin.H{"enabled": false}, nil
	}
	if !fresh.RejectPassword && !fresh.PasskeyOnly && !isPasskeyOnlyActive() {
		if err := bcrypt.CompareHashAndPassword([]byte(fresh.Password), []byte(form.Password)); err != nil {
			return nil, errors.New("当前登录密码不正确")
		}
	}
	if !verifyUserTOTPOrRecoveryCode(&fresh, form.Code) {
		return nil, errors.New("6 位动态验证码或应急恢复码不正确")
	}

	if err := singleton.DB.Model(&model.User{}).Where("id = ?", fresh.ID).Updates(map[string]any{
		"totp_enabled":         false,
		"totp_secret":          "",
		"totp_pending_secret":  "",
		"totp_recovery_hashes": "",
		"totp_last_used_step":  0,
	}).Error; err != nil {
		return nil, newGormError("%v", err)
	}
	return gin.H{"enabled": false}, nil
}
