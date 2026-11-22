package model

import (
	"os"
	"testing"
)

func TestThemeConfigValidation(t *testing.T) {
	def := DefaultThemeConfig()
	if err := ValidateThemeConfig(def); err != nil {
		t.Fatalf("DefaultThemeConfig should be valid, got: %v", err)
	}

	t.Run("rejects unsafe javascript URL", func(t *testing.T) {
		bad := DefaultThemeConfig()
		bad.Appearance.CustomLinks = []ThemeLink{{Name: "Bad", Link: "javascript:alert(1)"}}
		if err := ValidateThemeConfig(bad); err == nil {
			t.Fatal("expected error for javascript: URL")
		}
	})

	t.Run("allows relative paths and https URLs", func(t *testing.T) {
		ok := DefaultThemeConfig()
		ok.Appearance.CustomLogo = "/apple-touch-icon.png"
		ok.Appearance.CustomLinks = []ThemeLink{{Name: "Blog", Link: "https://example.com"}}
		if err := ValidateThemeConfig(ok); err != nil {
			t.Fatalf("expected valid config, got: %v", err)
		}
	})

	t.Run("rejects invalid refresh interval", func(t *testing.T) {
		bad := DefaultThemeConfig()
		bad.PingBoard.RefreshIntervalSec = 1
		if err := ValidateThemeConfig(bad); err == nil {
			t.Fatal("expected error for refresh_interval_sec < 5")
		}
	})
}

func TestThemeConfigPersistenceRoundTrip(t *testing.T) {
	t.Setenv(JWTSecretEnvKey, "test-jwt-secret")
	file := newTempConfig(t, "agent_secret_key: test-agent-secret\n")
	t.Cleanup(func() { _ = os.Remove(file) })

	c := &Config{}
	if err := c.Read(file, nil); err != nil {
		t.Fatalf("read failed: %v", err)
	}

	tc := DefaultThemeConfig()
	tc.Appearance.CustomDesc = "TG @Demo"
	tc.Appearance.CustomLinks = []ThemeLink{{Name: "Home", Link: "https://example.com"}}
	tc.FinanceWidget.DefaultCurrency = "USD"
	tc.RenewalCalendar.UrgentDays = 14
	c.ThemeConfig = tc

	if err := c.Save(); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	reloaded := &Config{}
	if err := reloaded.Read(file, nil); err != nil {
		t.Fatalf("reload failed: %v", err)
	}
	if reloaded.ThemeConfig == nil {
		t.Fatal("expected persisted theme_config after reload")
	}
	if reloaded.ThemeConfig.Appearance.CustomDesc != "TG @Demo" {
		t.Fatalf("unexpected custom_desc: %q", reloaded.ThemeConfig.Appearance.CustomDesc)
	}
	if len(reloaded.ThemeConfig.Appearance.CustomLinks) != 1 || reloaded.ThemeConfig.Appearance.CustomLinks[0].Name != "Home" {
		t.Fatalf("unexpected custom_links: %+v", reloaded.ThemeConfig.Appearance.CustomLinks)
	}
	if reloaded.ThemeConfig.FinanceWidget.DefaultCurrency != "USD" {
		t.Fatalf("unexpected default_currency: %q", reloaded.ThemeConfig.FinanceWidget.DefaultCurrency)
	}
	if reloaded.ThemeConfig.RenewalCalendar.UrgentDays != 14 {
		t.Fatalf("unexpected urgent_days: %d", reloaded.ThemeConfig.RenewalCalendar.UrgentDays)
	}
}
