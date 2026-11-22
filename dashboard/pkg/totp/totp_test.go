package totp

import (
	"strings"
	"testing"
	"time"
)

func TestRFC6238TestVectorAndReplayProtection(t *testing.T) {
	// RFC 6238 SHA-1 test secret "12345678901234567890" -> Base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	// Step at T = 59s -> floor(59/30) = 1 -> RFC 6238 8-digit 94287082 -> 6-digit 287082
	code, err := CodeForStep(secret, 1)
	if err != nil {
		t.Fatalf("CodeForStep failed: %v", err)
	}
	if code != "287082" {
		t.Fatalf("RFC 6238 mismatch: got %s, want 287082", code)
	}

	now := time.Unix(59, 0)
	step, ok := Verify(secret, "287082", now, 0)
	if !ok || step != 1 {
		t.Fatalf("expected valid verification at step 1, got step=%d ok=%v", step, ok)
	}

	// Replay protection: same code at same step MUST be rejected when lastUsedStep == 1
	if _, ok := Verify(secret, "287082", now, step); ok {
		t.Fatal("expected replayed TOTP code for already-used step to be rejected")
	}

	// Next 30-second window (step 2) succeeds
	nextCode, err := CodeForStep(secret, 2)
	if err != nil {
		t.Fatal(err)
	}
	if nextStep, ok := Verify(secret, nextCode, time.Unix(60, 0), step); !ok || nextStep != 2 {
		t.Fatalf("expected step 2 code to verify, got step=%d ok=%v", nextStep, ok)
	}
}

func TestSecretURIAndRecoveryCodes(t *testing.T) {
	secret, err := GenerateSecret()
	if err != nil || len(secret) < 26 {
		t.Fatalf("GenerateSecret failed: secret=%q err=%v", secret, err)
	}
	uri := BuildOTPAuthURI("江某人的鸡鸡们", "admin", secret)
	if !strings.HasPrefix(uri, "otpauth://totp/") || !strings.Contains(uri, "secret="+secret) {
		t.Fatalf("unexpected otpauth URI: %s", uri)
	}

	codes, err := GenerateRecoveryCodes(8)
	if err != nil || len(codes) != 8 {
		t.Fatalf("GenerateRecoveryCodes failed: %v", err)
	}
	for _, c := range codes {
		if len(c) != 9 || c[4] != '-' {
			t.Fatalf("unexpected recovery code format: %q", c)
		}
		if NormalizeRecoveryCode(strings.ToLower(strings.ReplaceAll(c, "-", " "))) != c {
			t.Fatalf("NormalizeRecoveryCode mismatch for %q", c)
		}
	}
}
