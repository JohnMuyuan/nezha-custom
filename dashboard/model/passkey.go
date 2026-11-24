package model

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// PasskeyCredential persists a WebAuthn / FIDO2 credential bound to the admin account.
type PasskeyCredential struct {
	ID              uint64     `gorm:"primaryKey" json:"-"`
	UserID          uint64     `gorm:"index;not null" json:"-"`
	CredentialID    string     `gorm:"uniqueIndex;type:varchar(512);not null" json:"id"` // Unpadded Base64URL
	PublicKey       []byte     `gorm:"type:blob;not null" json:"-"`
	AttestationType string     `gorm:"type:varchar(64)" json:"-"`
	AAGUID          string     `gorm:"type:varchar(64)" json:"aaguid"`
	SignCount       uint32     `gorm:"not null;default:0" json:"counter"`
	CloneWarning    bool       `gorm:"not null;default:false" json:"-"`
	BackupEligible  bool       `gorm:"not null;default:false" json:"-"`
	BackupState     bool       `gorm:"not null;default:false" json:"credential_backed_up"`
	TransportsJSON  string     `gorm:"type:text" json:"-"`
	Name            string     `gorm:"type:varchar(128)" json:"name"`
	LastUsedAt      *time.Time `json:"-"`
	CreatedAt       time.Time  `json:"-"`
	UpdatedAt       time.Time  `json:"-"`
}

func (PasskeyCredential) TableName() string {
	return "passkey_credentials"
}

// PasskeyCredentialView is the JSON view returned to the management UI (aligned with modern-web-guidance).
type PasskeyCredentialView struct {
	ID                   string   `json:"id"`
	Name                 string   `json:"name"`
	AAGUID               string   `json:"aaguid"`
	CredentialDeviceType string   `json:"credential_device_type"`
	CredentialBackedUp   bool     `json:"credential_backed_up"`
	Transports           []string `json:"transports"`
	Counter              uint32   `json:"counter"`
	RegisteredAt         int64    `json:"registered_at"`
	LastUsedAt           *int64   `json:"last_used_at,omitempty"`
}

func (p *PasskeyCredential) Transports() []string {
	if p == nil || p.TransportsJSON == "" {
		return []string{}
	}
	var list []string
	if err := json.Unmarshal([]byte(p.TransportsJSON), &list); err != nil {
		return []string{}
	}
	return list
}

func (p *PasskeyCredential) ToView() PasskeyCredentialView {
	deviceType := "singleDevice"
	if p.BackupEligible {
		deviceType = "multiDevice"
	}
	var lastUsed *int64
	if p.LastUsedAt != nil && !p.LastUsedAt.IsZero() {
		ms := p.LastUsedAt.UnixMilli()
		lastUsed = &ms
	}
	return PasskeyCredentialView{
		ID:                   p.CredentialID,
		Name:                 p.Name,
		AAGUID:               p.AAGUID,
		CredentialDeviceType: deviceType,
		CredentialBackedUp:   p.BackupState,
		Transports:           p.Transports(),
		Counter:              p.SignCount,
		RegisteredAt:         p.CreatedAt.UnixMilli(),
		LastUsedAt:           lastUsed,
	}
}

// ToWebAuthnCredential reconstructs a go-webauthn Credential for signature verification.
func (p *PasskeyCredential) ToWebAuthnCredential() (webauthn.Credential, error) {
	rawID, err := base64.RawURLEncoding.DecodeString(p.CredentialID)
	if err != nil {
		return webauthn.Credential{}, fmt.Errorf("invalid base64url credential id: %w", err)
	}
	rawTransports := p.Transports()
	protoTransports := make([]protocol.AuthenticatorTransport, 0, len(rawTransports))
	for _, t := range rawTransports {
		if t != "" {
			protoTransports = append(protoTransports, protocol.AuthenticatorTransport(t))
		}
	}
	return webauthn.Credential{
		ID:              rawID,
		PublicKey:       p.PublicKey,
		AttestationType: p.AttestationType,
		Transport:       protoTransports,
		Flags: webauthn.CredentialFlags{
			BackupEligible: p.BackupEligible,
			BackupState:    p.BackupState,
		},
		Authenticator: webauthn.Authenticator{
			AAGUID:       ParseAAGUIDBytes(p.AAGUID),
			SignCount:    p.SignCount,
			CloneWarning: p.CloneWarning,
		},
	}, nil
}

// FormatAAGUID formats 16 AAGUID bytes into canonical lowercase hyphenated UUID.
func FormatAAGUID(raw []byte) string {
	if len(raw) != 16 {
		return "00000000-0000-0000-0000-000000000000"
	}
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16])
}

// ParseAAGUIDBytes converts a canonical UUID string back to 16 bytes (zeroed on error).
func ParseAAGUIDBytes(uuid string) []byte {
	var b [16]byte
	var p1 uint32
	var p2, p3, p4 uint16
	var p5 uint64
	if _, err := fmt.Sscanf(uuid, "%08x-%04x-%04x-%04x-%012x", &p1, &p2, &p3, &p4, &p5); err != nil {
		return b[:]
	}
	b[0] = byte(p1 >> 24)
	b[1] = byte(p1 >> 16)
	b[2] = byte(p1 >> 8)
	b[3] = byte(p1)
	b[4] = byte(p2 >> 8)
	b[5] = byte(p2)
	b[6] = byte(p3 >> 8)
	b[7] = byte(p3)
	b[8] = byte(p4 >> 8)
	b[9] = byte(p4)
	b[10] = byte(p5 >> 40)
	b[11] = byte(p5 >> 32)
	b[12] = byte(p5 >> 24)
	b[13] = byte(p5 >> 16)
	b[14] = byte(p5 >> 8)
	b[15] = byte(p5)
	return b[:]
}

// TrustedDevice tracks a browser/device that passed 2FA verification so subsequent
// Passkey sign-ins after session expiry do not prompt for TOTP again for 180 days.
type TrustedDevice struct {
	ID         uint64     `gorm:"primaryKey" json:"id"`
	UserID     uint64     `gorm:"index;not null" json:"-"`
	TokenHash  string     `gorm:"uniqueIndex;type:char(64);not null" json:"-"`
	DeviceName string     `gorm:"type:varchar(128)" json:"device_name"`
	UserAgent  string     `gorm:"type:varchar(512)" json:"user_agent"`
	LastIP     string     `gorm:"type:varchar(64)" json:"last_ip"`
	ExpiresAt  time.Time  `gorm:"index;not null" json:"expires_at"`
	LastUsedAt time.Time  `gorm:"not null" json:"last_used_at"`
	RevokedAt  *time.Time `gorm:"index" json:"-"`
	CreatedAt  time.Time  `json:"created_at"`
}

func (TrustedDevice) TableName() string {
	return "trusted_devices"
}

type TrustedDeviceView struct {
	ID         uint64 `json:"id"`
	DeviceName string `json:"device_name"`
	LastIP     string `json:"last_ip"`
	IsCurrent  bool   `json:"is_current"`
	CreatedAt  int64  `json:"created_at"`
	LastUsedAt int64  `json:"last_used_at"`
	ExpiresAt  int64  `json:"expires_at"`
}
