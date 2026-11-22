package model

import (
	"fmt"
	"net/url"
	"strings"
)

const DefaultCNHolidays = "1-1,1-2,1-3,2-16,2-17,2-18,2-19,2-20,2-21,2-22,4-4,4-5,4-6,5-1,5-2,5-3,5-4,5-5,6-19,6-20,6-21,9-25,9-26,9-27,10-1,10-2,10-3,10-4,10-5,10-6,10-7"

type ThemeLink struct {
	Name string `koanf:"name" json:"name"`
	Link string `koanf:"link" json:"link"`
}

type ThemeAppearanceConfig struct {
	CustomDesc            string      `koanf:"custom_desc" json:"custom_desc"`
	CustomLogo            string      `koanf:"custom_logo" json:"custom_logo"`
	BackgroundImage       string      `koanf:"background_image" json:"background_image"`
	MobileBackgroundImage string      `koanf:"mobile_background_image" json:"mobile_background_image"`
	BackgroundBlur        bool        `koanf:"background_blur" json:"background_blur"`
	HideFooter            bool        `koanf:"hide_footer" json:"hide_footer"`
	ShowNetTransfer       bool        `koanf:"show_net_transfer" json:"show_net_transfer"`
	DisableAnimatedMan    bool        `koanf:"disable_animated_man" json:"disable_animated_man"`
	FixedTopServerName    bool        `koanf:"fixed_top_server_name" json:"fixed_top_server_name"`
	FontPreset            string      `koanf:"font_preset" json:"font_preset"` // default | misans | lxgw | custom
	CustomFontURL         string      `koanf:"custom_font_url" json:"custom_font_url"`
	CustomFontFamily      string      `koanf:"custom_font_family" json:"custom_font_family"`
	CustomLinks           []ThemeLink `koanf:"custom_links" json:"custom_links"`
}

type ThemeTrafficBarConfig struct {
	Enabled            bool `koanf:"enabled" json:"enabled"`
	InsertAfter        bool `koanf:"insert_after" json:"insert_after"`
	IntervalMs         int  `koanf:"interval_ms" json:"interval_ms"`
	ToggleIntervalMs   int  `koanf:"toggle_interval_ms" json:"toggle_interval_ms"`
	DurationMs         int  `koanf:"duration_ms" json:"duration_ms"`
	HideLegacyCycleBox bool `koanf:"hide_legacy_cycle_box" json:"hide_legacy_cycle_box"`
}

type ThemeRemainingValueConfig struct {
	Enabled         bool   `koanf:"enabled" json:"enabled"`
	TagText         string `koanf:"tag_text" json:"tag_text"`
	TagPosition     string `koanf:"tag_position" json:"tag_position"` // last | first
	DefaultCurrency string `koanf:"default_currency" json:"default_currency"`
}

type ThemeFinanceWidgetConfig struct {
	Enabled         bool   `koanf:"enabled" json:"enabled"`
	DefaultCurrency string `koanf:"default_currency" json:"default_currency"` // CNY | USD | HKD | EUR | GBP
}

type ThemeTradeCalcConfig struct {
	Enabled        bool   `koanf:"enabled" json:"enabled"`
	DefaultContact string `koanf:"default_contact" json:"default_contact"`
	DefaultNote    string `koanf:"default_note" json:"default_note"`
}

type ThemeWelcomeBubbleConfig struct {
	Enabled     bool   `koanf:"enabled" json:"enabled"`
	Title       string `koanf:"title" json:"title"`
	AutoCloseMs int    `koanf:"auto_close_ms" json:"auto_close_ms"`
}

type ThemeEarthGlobeConfig struct {
	Enabled         bool    `koanf:"enabled" json:"enabled"`
	AutoRotateSpeed float64 `koanf:"auto_rotate_speed" json:"auto_rotate_speed"`
}

type ThemePingBoardConfig struct {
	Enabled            bool `koanf:"enabled" json:"enabled"`
	DefaultOn          bool `koanf:"default_on" json:"default_on"`
	RefreshIntervalSec int  `koanf:"refresh_interval_sec" json:"refresh_interval_sec"`
}

type ThemeTrafficStatsConfig struct {
	Enabled bool `koanf:"enabled" json:"enabled"`
}

type ThemeGreetingConfig struct {
	Enabled        bool   `koanf:"enabled" json:"enabled"`
	ShowGreeting   bool   `koanf:"show_greeting" json:"show_greeting"`
	ShowUptime     bool   `koanf:"show_uptime" json:"show_uptime"`
	StartDate      string `koanf:"start_date" json:"start_date"`
	CustomHolidays string `koanf:"custom_holidays" json:"custom_holidays"`
}

type ThemeRenewalCalendarConfig struct {
	Enabled            bool `koanf:"enabled" json:"enabled"`
	EnableExpiryAlerts bool `koanf:"enable_expiry_alerts" json:"enable_expiry_alerts"`
	UrgentDays         int  `koanf:"urgent_days" json:"urgent_days"`
	MaxAlertCount      int  `koanf:"max_alert_count" json:"max_alert_count"`
}

type ThemeDockConfig struct {
	Enabled  bool   `koanf:"enabled" json:"enabled"`
	Position string `koanf:"position" json:"position"` // right | left
}

var DefaultMediaUnlockPlatforms = []string{
	"netflix",
	"disney",
	"youtube",
	"tiktok",
	"spotify",
	"prime",
	"hbo",
	"bilibili",
	"chatgpt",
	"claude",
	"gemini",
}

type ThemeMediaUnlockConfig struct {
	Enabled           bool     `koanf:"enabled" json:"enabled"`
	AutoIntervalHours int      `koanf:"auto_interval_hours" json:"auto_interval_hours"`
	MaxConcurrency    int      `koanf:"max_concurrency" json:"max_concurrency"`
	CheckIPv6         bool     `koanf:"check_ipv6" json:"check_ipv6"`
	CheckBackhaul     bool     `koanf:"check_backhaul" json:"check_backhaul"`
	CheckIPQuality    bool     `koanf:"check_ip_quality" json:"check_ip_quality"`
	SkipChinaMainland bool     `koanf:"skip_china_mainland" json:"skip_china_mainland"`
	Platforms         []string `koanf:"platforms" json:"platforms"`
}

type ThemeExpiryNotifyConfig struct {
	Enabled             bool   `koanf:"enabled" json:"enabled"`
	NotificationGroupID uint64 `koanf:"notification_group_id" json:"notification_group_id"`
	AlertDays           string `koanf:"alert_days" json:"alert_days"`
	CheckHour           int    `koanf:"check_hour" json:"check_hour"`
}

type ThemeShowcaseCardConfig struct {
	Enabled bool `koanf:"enabled" json:"enabled"`
}

type ThemeFilterBarConfig struct {
	Enabled bool `koanf:"enabled" json:"enabled"`
}

type ThemeConfig struct {
	Appearance      ThemeAppearanceConfig      `koanf:"appearance" json:"appearance"`
	TrafficBar      ThemeTrafficBarConfig      `koanf:"traffic_bar" json:"traffic_bar"`
	RemainingValue  ThemeRemainingValueConfig  `koanf:"remaining_value" json:"remaining_value"`
	FinanceWidget   ThemeFinanceWidgetConfig   `koanf:"finance_widget" json:"finance_widget"`
	TradeCalc       ThemeTradeCalcConfig       `koanf:"trade_calc" json:"trade_calc"`
	WelcomeBubble   ThemeWelcomeBubbleConfig   `koanf:"welcome_bubble" json:"welcome_bubble"`
	EarthGlobe      ThemeEarthGlobeConfig      `koanf:"earth_globe" json:"earth_globe"`
	PingBoard       ThemePingBoardConfig       `koanf:"ping_board" json:"ping_board"`
	TrafficStats    ThemeTrafficStatsConfig    `koanf:"traffic_stats" json:"traffic_stats"`
	Greeting        ThemeGreetingConfig        `koanf:"greeting" json:"greeting"`
	RenewalCalendar ThemeRenewalCalendarConfig `koanf:"renewal_calendar" json:"renewal_calendar"`
	Dock            ThemeDockConfig            `koanf:"dock" json:"dock"`
	MediaUnlock     ThemeMediaUnlockConfig     `koanf:"media_unlock" json:"media_unlock"`
	ExpiryNotify    ThemeExpiryNotifyConfig    `koanf:"expiry_notify" json:"expiry_notify"`
	ShowcaseCard    ThemeShowcaseCardConfig    `koanf:"showcase_card" json:"showcase_card"`
	FilterBar       ThemeFilterBarConfig       `koanf:"filter_bar" json:"filter_bar"`
}

func DefaultThemeConfig() *ThemeConfig {
	return &ThemeConfig{
		Appearance: ThemeAppearanceConfig{
			CustomDesc:         "",
			BackgroundBlur:     true,
			HideFooter:         true,
			ShowNetTransfer:    true,
			DisableAnimatedMan: true,
			FixedTopServerName: true,
			FontPreset:         "misans",
			CustomLinks:        []ThemeLink{},
		},
		TrafficBar: ThemeTrafficBarConfig{
			Enabled:            true,
			InsertAfter:        true,
			IntervalMs:         60000,
			ToggleIntervalMs:   5000,
			DurationMs:         500,
			HideLegacyCycleBox: true,
		},
		RemainingValue: ThemeRemainingValueConfig{
			Enabled:         true,
			TagText:         "剩余",
			TagPosition:     "last",
			DefaultCurrency: "$",
		},
		FinanceWidget: ThemeFinanceWidgetConfig{
			Enabled:         true,
			DefaultCurrency: "CNY",
		},
		TradeCalc: ThemeTradeCalcConfig{
			Enabled:        true,
			DefaultContact: "站内私信 / PM",
			DefaultNote:    "支付宝口令红包或中介交易，中介费自理",
		},
		WelcomeBubble: ThemeWelcomeBubbleConfig{
			Enabled:     true,
			Title:       "Hello!",
			AutoCloseMs: 8000,
		},
		EarthGlobe: ThemeEarthGlobeConfig{
			Enabled:         true,
			AutoRotateSpeed: 0.6,
		},
		PingBoard: ThemePingBoardConfig{
			Enabled:            true,
			DefaultOn:          false,
			RefreshIntervalSec: 20,
		},
		TrafficStats: ThemeTrafficStatsConfig{
			Enabled: true,
		},
		Greeting: ThemeGreetingConfig{
			Enabled:        true,
			ShowGreeting:   true,
			ShowUptime:     true,
			StartDate:      "2025-03-17T18:55:00",
			CustomHolidays: DefaultCNHolidays,
		},
		RenewalCalendar: ThemeRenewalCalendarConfig{
			Enabled:            true,
			EnableExpiryAlerts: true,
			UrgentDays:         7,
			MaxAlertCount:      3,
		},
		Dock: ThemeDockConfig{
			Enabled:  true,
			Position: "right",
		},
		MediaUnlock: ThemeMediaUnlockConfig{
			Enabled:           true,
			AutoIntervalHours: 24,
			MaxConcurrency:    2,
			CheckIPv6:         true,
			CheckBackhaul:     true,
			CheckIPQuality:    true,
			SkipChinaMainland: true,
			Platforms:         append([]string(nil), DefaultMediaUnlockPlatforms...),
		},
		ExpiryNotify: ThemeExpiryNotifyConfig{
			Enabled:             false,
			NotificationGroupID: 0,
			AlertDays:           "7,3,1",
			CheckHour:           9,
		},
		ShowcaseCard: ThemeShowcaseCardConfig{
			Enabled: true,
		},
		FilterBar: ThemeFilterBarConfig{
			Enabled: true,
		},
	}
}

func (tc *ThemeConfig) Clone() *ThemeConfig {
	if tc == nil {
		return nil
	}
	copied := *tc
	if tc.Appearance.CustomLinks != nil {
		copied.Appearance.CustomLinks = make([]ThemeLink, len(tc.Appearance.CustomLinks))
		copy(copied.Appearance.CustomLinks, tc.Appearance.CustomLinks)
	}
	if tc.MediaUnlock.Platforms != nil {
		copied.MediaUnlock.Platforms = make([]string, len(tc.MediaUnlock.Platforms))
		copy(copied.MediaUnlock.Platforms, tc.MediaUnlock.Platforms)
	}
	return &copied
}

// FillLegacyDefaults backfills newly introduced subsections with safe defaults
// when loading an older config.yaml that predated those fields.
func (tc *ThemeConfig) FillLegacyDefaults() {
	if tc == nil {
		return
	}
	if tc.MediaUnlock.MaxConcurrency <= 0 {
		tc.MediaUnlock.MaxConcurrency = 2
	}
	if len(tc.MediaUnlock.Platforms) == 0 {
		tc.MediaUnlock.Platforms = append([]string(nil), DefaultMediaUnlockPlatforms...)
	}
	if strings.TrimSpace(tc.ExpiryNotify.AlertDays) == "" {
		tc.ExpiryNotify.AlertDays = "7,3,1"
	}
}

func validateSafeWebURL(raw, field string) error {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	if strings.HasPrefix(trimmed, "/") && !strings.HasPrefix(trimmed, "//") {
		return nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return fmt.Errorf("%s is not a valid URL", field)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("%s must use http, https, or a relative path", field)
	}
	return nil
}

func ValidateThemeConfig(tc *ThemeConfig) error {
	if tc == nil {
		return nil
	}

	// Appearance
	if err := validateSafeWebURL(tc.Appearance.CustomLogo, "theme_config.appearance.custom_logo"); err != nil {
		return err
	}
	if err := validateSafeWebURL(tc.Appearance.BackgroundImage, "theme_config.appearance.background_image"); err != nil {
		return err
	}
	if err := validateSafeWebURL(tc.Appearance.MobileBackgroundImage, "theme_config.appearance.mobile_background_image"); err != nil {
		return err
	}
	if err := validateSafeWebURL(tc.Appearance.CustomFontURL, "theme_config.appearance.custom_font_url"); err != nil {
		return err
	}
	switch tc.Appearance.FontPreset {
	case "", "default", "misans", "lxgw", "custom":
	default:
		return fmt.Errorf("invalid theme_config.appearance.font_preset: %s", tc.Appearance.FontPreset)
	}
	for i, item := range tc.Appearance.CustomLinks {
		if err := validateSafeWebURL(item.Link, fmt.Sprintf("theme_config.appearance.custom_links[%d].link", i)); err != nil {
			return err
		}
	}

	// Traffic bar
	if tc.TrafficBar.IntervalMs < 5000 || tc.TrafficBar.IntervalMs > 3600000 {
		return fmt.Errorf("theme_config.traffic_bar.interval_ms must be between 5000 and 3600000")
	}
	if tc.TrafficBar.ToggleIntervalMs < 0 || tc.TrafficBar.ToggleIntervalMs > 600000 {
		return fmt.Errorf("theme_config.traffic_bar.toggle_interval_ms must be between 0 and 600000")
	}
	if tc.TrafficBar.DurationMs < 0 || tc.TrafficBar.DurationMs > 5000 {
		return fmt.Errorf("theme_config.traffic_bar.duration_ms must be between 0 and 5000")
	}

	// Remaining value
	switch tc.RemainingValue.TagPosition {
	case "", "first", "last":
	default:
		return fmt.Errorf("invalid theme_config.remaining_value.tag_position: %s", tc.RemainingValue.TagPosition)
	}

	// Finance widget
	switch tc.FinanceWidget.DefaultCurrency {
	case "", "CNY", "USD", "HKD", "EUR", "GBP":
	default:
		return fmt.Errorf("invalid theme_config.finance_widget.default_currency: %s", tc.FinanceWidget.DefaultCurrency)
	}

	// Welcome bubble
	if tc.WelcomeBubble.AutoCloseMs < 0 || tc.WelcomeBubble.AutoCloseMs > 300000 {
		return fmt.Errorf("theme_config.welcome_bubble.auto_close_ms must be between 0 and 300000")
	}

	// Earth globe
	if tc.EarthGlobe.AutoRotateSpeed < 0 || tc.EarthGlobe.AutoRotateSpeed > 10 {
		return fmt.Errorf("theme_config.earth_globe.auto_rotate_speed must be between 0 and 10")
	}

	// Ping board
	if tc.PingBoard.RefreshIntervalSec < 5 || tc.PingBoard.RefreshIntervalSec > 600 {
		return fmt.Errorf("theme_config.ping_board.refresh_interval_sec must be between 5 and 600")
	}

	// Renewal calendar
	if tc.RenewalCalendar.UrgentDays < 0 || tc.RenewalCalendar.UrgentDays > 365 {
		return fmt.Errorf("theme_config.renewal_calendar.urgent_days must be between 0 and 365")
	}
	if tc.RenewalCalendar.MaxAlertCount < 1 || tc.RenewalCalendar.MaxAlertCount > 20 {
		return fmt.Errorf("theme_config.renewal_calendar.max_alert_count must be between 1 and 20")
	}

	// Dock
	switch tc.Dock.Position {
	case "", "right", "left":
	default:
		return fmt.Errorf("invalid theme_config.dock.position: %s", tc.Dock.Position)
	}

	// Media unlock & inspection
	if tc.MediaUnlock.AutoIntervalHours < 0 || tc.MediaUnlock.AutoIntervalHours > 720 {
		return fmt.Errorf("theme_config.media_unlock.auto_interval_hours must be between 0 and 720")
	}
	if tc.MediaUnlock.MaxConcurrency != 0 && (tc.MediaUnlock.MaxConcurrency < 1 || tc.MediaUnlock.MaxConcurrency > 5) {
		return fmt.Errorf("theme_config.media_unlock.max_concurrency must be between 1 and 5")
	}
	allowedPlatforms := map[string]struct{}{
		"netflix": {}, "disney": {}, "youtube": {}, "tiktok": {},
		"spotify": {}, "prime": {}, "hbo": {}, "bilibili": {},
		"chatgpt": {}, "claude": {}, "gemini": {},
	}
	for _, p := range tc.MediaUnlock.Platforms {
		if _, ok := allowedPlatforms[strings.ToLower(strings.TrimSpace(p))]; !ok {
			return fmt.Errorf("invalid theme_config.media_unlock.platforms entry: %s", p)
		}
	}

	// Expiry notification
	if tc.ExpiryNotify.CheckHour < 0 || tc.ExpiryNotify.CheckHour > 23 {
		return fmt.Errorf("theme_config.expiry_notify.check_hour must be between 0 and 23")
	}

	return nil
}
