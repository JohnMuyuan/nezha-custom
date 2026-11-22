export interface ThemeLink {
    name: string
    link: string
}

export interface ThemeAppearanceConfig {
    custom_desc: string
    custom_logo: string
    background_image: string
    mobile_background_image: string
    background_blur: boolean
    hide_footer: boolean
    show_net_transfer: boolean
    disable_animated_man: boolean
    fixed_top_server_name: boolean
    font_preset: "default" | "misans" | "lxgw" | "custom"
    custom_font_url: string
    custom_font_family: string
    custom_links: ThemeLink[]
}

export interface ThemeTrafficBarConfig {
    enabled: boolean
    insert_after: boolean
    interval_ms: number
    toggle_interval_ms: number
    duration_ms: number
    hide_legacy_cycle_box: boolean
}

export interface ThemeRemainingValueConfig {
    enabled: boolean
    tag_text: string
    tag_position: "last" | "first"
    default_currency: string
}

export interface ThemeFinanceWidgetConfig {
    enabled: boolean
    default_currency: "CNY" | "USD" | "HKD" | "EUR" | "GBP"
}

export interface ThemeTradeCalcConfig {
    enabled: boolean
    default_contact: string
    default_note: string
}

export interface ThemeWelcomeBubbleConfig {
    enabled: boolean
    title: string
    auto_close_ms: number
}

export interface ThemeEarthGlobeConfig {
    enabled: boolean
    auto_rotate_speed: number
}

export interface ThemePingBoardConfig {
    enabled: boolean
    default_on: boolean
    refresh_interval_sec: number
}

export interface ThemeTrafficStatsConfig {
    enabled: boolean
}

export interface ThemeGreetingConfig {
    enabled: boolean
    show_greeting: boolean
    show_uptime: boolean
    start_date: string
    custom_holidays: string
}

export interface ThemeRenewalCalendarConfig {
    enabled: boolean
    enable_expiry_alerts: boolean
    urgent_days: number
    max_alert_count: number
}

export interface ThemeDockConfig {
    enabled: boolean
    position: "right" | "left"
}

export interface ThemeConfig {
    appearance: ThemeAppearanceConfig
    traffic_bar: ThemeTrafficBarConfig
    remaining_value: ThemeRemainingValueConfig
    finance_widget: ThemeFinanceWidgetConfig
    trade_calc: ThemeTradeCalcConfig
    welcome_bubble: ThemeWelcomeBubbleConfig
    earth_globe: ThemeEarthGlobeConfig
    ping_board: ThemePingBoardConfig
    traffic_stats: ThemeTrafficStatsConfig
    greeting: ThemeGreetingConfig
    renewal_calendar: ThemeRenewalCalendarConfig
    dock: ThemeDockConfig
}

export const DEFAULT_CN_HOLIDAYS =
    "1-1,1-2,1-3,2-16,2-17,2-18,2-19,2-20,2-21,2-22,4-4,4-5,4-6,5-1,5-2,5-3,5-4,5-5,6-19,6-20,6-21,9-25,9-26,9-27,10-1,10-2,10-3,10-4,10-5,10-6,10-7"

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
    appearance: {
        custom_desc: "",
        custom_logo: "",
        background_image: "",
        mobile_background_image: "",
        background_blur: true,
        hide_footer: true,
        show_net_transfer: true,
        disable_animated_man: true,
        fixed_top_server_name: true,
        font_preset: "misans",
        custom_font_url: "",
        custom_font_family: "",
        custom_links: [],
    },
    traffic_bar: {
        enabled: true,
        insert_after: true,
        interval_ms: 60000,
        toggle_interval_ms: 5000,
        duration_ms: 500,
        hide_legacy_cycle_box: true,
    },
    remaining_value: {
        enabled: true,
        tag_text: "剩余",
        tag_position: "last",
        default_currency: "$",
    },
    finance_widget: {
        enabled: true,
        default_currency: "CNY",
    },
    trade_calc: {
        enabled: true,
        default_contact: "站内私信 / PM",
        default_note: "支付宝口令红包或中介交易，中介费自理",
    },
    welcome_bubble: {
        enabled: true,
        title: "Hello!",
        auto_close_ms: 8000,
    },
    earth_globe: {
        enabled: true,
        auto_rotate_speed: 0.6,
    },
    ping_board: {
        enabled: true,
        default_on: false,
        refresh_interval_sec: 20,
    },
    traffic_stats: {
        enabled: true,
    },
    greeting: {
        enabled: true,
        show_greeting: true,
        show_uptime: true,
        start_date: "2025-03-17T18:55:00",
        custom_holidays: DEFAULT_CN_HOLIDAYS,
    },
    renewal_calendar: {
        enabled: true,
        enable_expiry_alerts: true,
        urgent_days: 7,
        max_alert_count: 3,
    },
    dock: {
        enabled: true,
        position: "right",
    },
}

export function mergeThemeConfig(raw?: Partial<ThemeConfig> | null): ThemeConfig {
    if (!raw) return structuredClone(DEFAULT_THEME_CONFIG)
    return {
        appearance: {
            ...DEFAULT_THEME_CONFIG.appearance,
            ...(raw.appearance ?? {}),
            custom_links: Array.isArray(raw.appearance?.custom_links)
                ? raw.appearance.custom_links.map((item) => ({
                      name: item.name ?? "",
                      link: item.link ?? "",
                  }))
                : [],
        },
        traffic_bar: { ...DEFAULT_THEME_CONFIG.traffic_bar, ...(raw.traffic_bar ?? {}) },
        remaining_value: {
            ...DEFAULT_THEME_CONFIG.remaining_value,
            ...(raw.remaining_value ?? {}),
        },
        finance_widget: {
            ...DEFAULT_THEME_CONFIG.finance_widget,
            ...(raw.finance_widget ?? {}),
        },
        trade_calc: { ...DEFAULT_THEME_CONFIG.trade_calc, ...(raw.trade_calc ?? {}) },
        welcome_bubble: {
            ...DEFAULT_THEME_CONFIG.welcome_bubble,
            ...(raw.welcome_bubble ?? {}),
        },
        earth_globe: { ...DEFAULT_THEME_CONFIG.earth_globe, ...(raw.earth_globe ?? {}) },
        ping_board: { ...DEFAULT_THEME_CONFIG.ping_board, ...(raw.ping_board ?? {}) },
        traffic_stats: {
            ...DEFAULT_THEME_CONFIG.traffic_stats,
            ...(raw.traffic_stats ?? {}),
        },
        greeting: { ...DEFAULT_THEME_CONFIG.greeting, ...(raw.greeting ?? {}) },
        renewal_calendar: {
            ...DEFAULT_THEME_CONFIG.renewal_calendar,
            ...(raw.renewal_calendar ?? {}),
        },
        dock: { ...DEFAULT_THEME_CONFIG.dock, ...(raw.dock ?? {}) },
    }
}
