package totp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // #nosec G505 -- RFC 6238 standard TOTP uses HMAC-SHA1 for universal Authenticator app compatibility
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	PeriodSeconds = 30
	Digits        = 6
	SkewSteps     = 1 // Accept -30s, 0, +30s to absorb minor clock drift
)

var base32NoPad = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateSecret creates a cryptographically random 160-bit Base32 TOTP secret (RFC 6238).
func GenerateSecret() (string, error) {
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base32NoPad.EncodeToString(raw), nil
}

// BuildOTPAuthURI returns the standard otpauth://totp/ URI for QR code scanning.
func BuildOTPAuthURI(issuer, account, secret string) string {
	issuer = strings.TrimSpace(issuer)
	if issuer == "" {
		issuer = "Nezha"
	}
	account = strings.TrimSpace(account)
	if account == "" {
		account = "admin"
	}
	label := url.PathEscape(issuer + ":" + account)
	q := url.Values{}
	q.Set("secret", NormalizeSecret(secret))
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", "6")
	q.Set("period", "30")
	return fmt.Sprintf("otpauth://totp/%s?%s", label, q.Encode())
}

// NormalizeSecret strips spaces/hyphens and uppercases a Base32 secret.
func NormalizeSecret(secret string) string {
	s := strings.ToUpper(strings.TrimSpace(secret))
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "-", "")
	return strings.TrimRight(s, "=")
}

// CodeForStep computes the 6-digit RFC 6238 TOTP code for a specific 30-second counter step.
func CodeForStep(secret string, step int64) (string, error) {
	if step < 0 {
		return "", errors.New("invalid TOTP step")
	}
	key, err := base32NoPad.DecodeString(NormalizeSecret(secret))
	if err != nil || len(key) < 10 {
		return "", errors.New("invalid TOTP secret")
	}
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(step))

	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(msg[:])
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	binCode := (uint32(sum[offset]&0x7f) << 24) |
		(uint32(sum[offset+1]) << 16) |
		(uint32(sum[offset+2]) << 8) |
		uint32(sum[offset+3])

	otp := binCode % 1_000_000
	return fmt.Sprintf("%06d", otp), nil
}

// Verify checks a user-entered 6-digit TOTP code against now (±1 step) while enforcing replay protection
// against lastUsedStep (pass 0 during initial enrollment). Returns the matched step and true on success.
func Verify(secret, userCode string, now time.Time, lastUsedStep int64) (int64, bool) {
	code := strings.TrimSpace(userCode)
	code = strings.ReplaceAll(code, " ", "")
	code = strings.ReplaceAll(code, "-", "")
	if len(code) != Digits {
		return 0, false
	}
	for i := 0; i < len(code); i++ {
		if code[i] < '0' || code[i] > '9' {
			return 0, false
		}
	}

	curStep := now.Unix() / PeriodSeconds
	for delta := int64(-SkewSteps); delta <= int64(SkewSteps); delta++ {
		step := curStep + delta
		if step <= lastUsedStep {
			continue
		}
		expected, err := CodeForStep(secret, step)
		if err != nil {
			return 0, false
		}
		if subtle.ConstantTimeCompare([]byte(code), []byte(expected)) == 1 {
			return step, true
		}
	}
	return 0, false
}

// GenerateRecoveryCodes returns count single-use emergency backup codes formatted like "A1B2-C3D4".
func GenerateRecoveryCodes(count int) ([]string, error) {
	if count <= 0 {
		count = 8
	}
	codes := make([]string, 0, count)
	for i := 0; i < count; i++ {
		var b [4]byte
		if _, err := rand.Read(b[:]); err != nil {
			return nil, err
		}
		h := strings.ToUpper(hex.EncodeToString(b[:]))
		codes = append(codes, h[:4]+"-"+h[4:])
	}
	return codes, nil
}

// NormalizeRecoveryCode normalizes user input ("a1b2 c3d4" / "A1B2-C3D4" -> "A1B2-C3D4").
func NormalizeRecoveryCode(raw string) string {
	s := strings.ToUpper(strings.TrimSpace(raw))
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "-", "")
	if len(s) == 8 {
		return s[:4] + "-" + s[4:]
	}
	return s
}
