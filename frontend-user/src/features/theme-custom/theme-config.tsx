import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { safeLocalStorage } from "@/lib/storage";

export interface ThemeLink {
	name: string;
	link: string;
}

export interface ThemeAppearanceConfig {
	custom_desc: string;
	custom_logo: string;
	background_image: string;
	mobile_background_image: string;
	background_blur: boolean;
	hide_footer: boolean;
	show_net_transfer: boolean;
	disable_animated_man: boolean;
	fixed_top_server_name: boolean;
	font_preset: "default" | "misans" | "lxgw" | "custom";
	custom_font_url: string;
	custom_font_family: string;
	custom_links: ThemeLink[];
}

export interface ThemeTrafficBarConfig {
	enabled: boolean;
	auto_record: boolean;
	insert_after: boolean;
	interval_ms: number;
	toggle_interval_ms: number;
	duration_ms: number;
	hide_legacy_cycle_box: boolean;
}

export interface ThemeRemainingValueConfig {
	enabled: boolean;
	tag_text: string;
	tag_position: "last" | "first";
	default_currency: string;
}

export interface ThemeFinanceWidgetConfig {
	enabled: boolean;
	default_currency: "CNY" | "USD" | "HKD" | "EUR" | "GBP";
}

export interface ThemeTradeCalcConfig {
	enabled: boolean;
	default_contact: string;
	default_note: string;
}

export interface ThemeWelcomeBubbleConfig {
	enabled: boolean;
	title: string;
	auto_close_ms: number;
}

export interface ThemeEarthGlobeConfig {
	enabled: boolean;
	auto_rotate_speed: number;
}

export interface ThemePingBoardConfig {
	enabled: boolean;
	default_on: boolean;
	refresh_interval_sec: number;
}

export interface ThemeTrafficStatsConfig {
	enabled: boolean;
}

export interface ThemeGreetingConfig {
	enabled: boolean;
	show_greeting: boolean;
	show_uptime: boolean;
	start_date: string;
	custom_holidays: string;
}

export interface ThemeRenewalCalendarConfig {
	enabled: boolean;
	enable_expiry_alerts: boolean;
	urgent_days: number;
	max_alert_count: number;
}

export interface ThemeDockConfig {
	enabled: boolean;
	position: "right" | "left";
}

export const DEFAULT_MEDIA_PLATFORMS = [
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
] as const;

export interface ThemeMediaUnlockConfig {
	enabled: boolean;
	auto_interval_hours: number;
	max_concurrency: number;
	check_ipv6: boolean;
	check_backhaul: boolean;
	check_ip_quality: boolean;
	skip_china_mainland: boolean;
	platforms: string[];
}

export interface ThemeExpiryNotifyConfig {
	enabled: boolean;
	notification_group_id: number;
	alert_days: string;
	check_hour: number;
}

export interface ThemeShowcaseCardConfig {
	enabled: boolean;
}

export interface ThemeFilterBarConfig {
	enabled: boolean;
}

export interface ThemeConfig {
	appearance: ThemeAppearanceConfig;
	traffic_bar: ThemeTrafficBarConfig;
	remaining_value: ThemeRemainingValueConfig;
	finance_widget: ThemeFinanceWidgetConfig;
	trade_calc: ThemeTradeCalcConfig;
	welcome_bubble: ThemeWelcomeBubbleConfig;
	earth_globe: ThemeEarthGlobeConfig;
	ping_board: ThemePingBoardConfig;
	traffic_stats: ThemeTrafficStatsConfig;
	greeting: ThemeGreetingConfig;
	renewal_calendar: ThemeRenewalCalendarConfig;
	dock: ThemeDockConfig;
	media_unlock: ThemeMediaUnlockConfig;
	expiry_notify: ThemeExpiryNotifyConfig;
	showcase_card: ThemeShowcaseCardConfig;
	filter_bar: ThemeFilterBarConfig;
}

export const DEFAULT_CN_HOLIDAYS =
	"1-1,1-2,1-3,2-16,2-17,2-18,2-19,2-20,2-21,2-22,4-4,4-5,4-6,5-1,5-2,5-3,5-4,5-5,6-19,6-20,6-21,9-25,9-26,9-27,10-1,10-2,10-3,10-4,10-5,10-6,10-7";

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
		auto_record: true,
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
	media_unlock: {
		enabled: true,
		auto_interval_hours: 24,
		max_concurrency: 2,
		check_ipv6: true,
		check_backhaul: true,
		check_ip_quality: true,
		skip_china_mainland: true,
		platforms: [...DEFAULT_MEDIA_PLATFORMS],
	},
	expiry_notify: {
		enabled: false,
		notification_group_id: 0,
		alert_days: "7,3,1",
		check_hour: 9,
	},
	showcase_card: {
		enabled: true,
	},
	filter_bar: {
		enabled: true,
	},
};

export const PASSIVE_THEME_CONFIG: ThemeConfig = {
	...DEFAULT_THEME_CONFIG,
	appearance: {
		...DEFAULT_THEME_CONFIG.appearance,
		background_blur: false,
		hide_footer: false,
		show_net_transfer: false,
		disable_animated_man: false,
		fixed_top_server_name: false,
		font_preset: "default",
	},
	traffic_bar: {
		...DEFAULT_THEME_CONFIG.traffic_bar,
		enabled: false,
		hide_legacy_cycle_box: false,
	},
	remaining_value: { ...DEFAULT_THEME_CONFIG.remaining_value, enabled: false },
	finance_widget: { ...DEFAULT_THEME_CONFIG.finance_widget, enabled: false },
	trade_calc: { ...DEFAULT_THEME_CONFIG.trade_calc, enabled: false },
	welcome_bubble: { ...DEFAULT_THEME_CONFIG.welcome_bubble, enabled: false },
	earth_globe: { ...DEFAULT_THEME_CONFIG.earth_globe, enabled: false },
	ping_board: { ...DEFAULT_THEME_CONFIG.ping_board, enabled: false },
	traffic_stats: { ...DEFAULT_THEME_CONFIG.traffic_stats, enabled: false },
	greeting: { ...DEFAULT_THEME_CONFIG.greeting, enabled: false },
	renewal_calendar: {
		...DEFAULT_THEME_CONFIG.renewal_calendar,
		enabled: false,
		enable_expiry_alerts: false,
	},
	dock: { ...DEFAULT_THEME_CONFIG.dock, enabled: false },
	media_unlock: { ...DEFAULT_THEME_CONFIG.media_unlock, enabled: false },
	expiry_notify: { ...DEFAULT_THEME_CONFIG.expiry_notify, enabled: false },
	showcase_card: { ...DEFAULT_THEME_CONFIG.showcase_card, enabled: false },
	filter_bar: { ...DEFAULT_THEME_CONFIG.filter_bar, enabled: false },
};

export function mergeThemeConfig(
	raw?: Partial<ThemeConfig> | null,
): ThemeConfig {
	if (!raw) return PASSIVE_THEME_CONFIG;
	return {
		appearance: {
			...DEFAULT_THEME_CONFIG.appearance,
			...(raw.appearance ?? {}),
			custom_links: Array.isArray(raw.appearance?.custom_links)
				? raw.appearance.custom_links.filter(
						(item): item is ThemeLink =>
							Boolean(item) &&
							typeof item.name === "string" &&
							typeof item.link === "string",
					)
				: [],
		},
		traffic_bar: {
			...DEFAULT_THEME_CONFIG.traffic_bar,
			...(raw.traffic_bar ?? {}),
		},
		remaining_value: {
			...DEFAULT_THEME_CONFIG.remaining_value,
			...(raw.remaining_value ?? {}),
		},
		finance_widget: {
			...DEFAULT_THEME_CONFIG.finance_widget,
			...(raw.finance_widget ?? {}),
		},
		trade_calc: {
			...DEFAULT_THEME_CONFIG.trade_calc,
			...(raw.trade_calc ?? {}),
		},
		welcome_bubble: {
			...DEFAULT_THEME_CONFIG.welcome_bubble,
			...(raw.welcome_bubble ?? {}),
		},
		earth_globe: {
			...DEFAULT_THEME_CONFIG.earth_globe,
			...(raw.earth_globe ?? {}),
		},
		ping_board: {
			...DEFAULT_THEME_CONFIG.ping_board,
			...(raw.ping_board ?? {}),
		},
		traffic_stats: {
			...DEFAULT_THEME_CONFIG.traffic_stats,
			...(raw.traffic_stats ?? {}),
		},
		greeting: {
			...DEFAULT_THEME_CONFIG.greeting,
			...(raw.greeting ?? {}),
		},
		renewal_calendar: {
			...DEFAULT_THEME_CONFIG.renewal_calendar,
			...(raw.renewal_calendar ?? {}),
		},
		dock: {
			...DEFAULT_THEME_CONFIG.dock,
			...(raw.dock ?? {}),
		},
		media_unlock: {
			...DEFAULT_THEME_CONFIG.media_unlock,
			...(raw.media_unlock ?? {}),
			platforms:
				Array.isArray(raw.media_unlock?.platforms) &&
				raw.media_unlock.platforms.length > 0
					? [...raw.media_unlock.platforms]
					: [...DEFAULT_MEDIA_PLATFORMS],
		},
		expiry_notify: {
			...DEFAULT_THEME_CONFIG.expiry_notify,
			...(raw.expiry_notify ?? {}),
		},
		showcase_card: {
			...DEFAULT_THEME_CONFIG.showcase_card,
			...(raw.showcase_card ?? {}),
		},
		filter_bar: {
			...DEFAULT_THEME_CONFIG.filter_bar,
			...(raw.filter_bar ?? {}),
		},
	};
}

export const FONT_PRESETS: Record<
	"misans" | "lxgw",
	{ url: string; family: string }
> = {
	misans: {
		url: "https://font.sec.miui.com/font/css?family=MiSans:400,700:MiSans",
		family: "'MiSans', Inter, system-ui, sans-serif",
	},
	lxgw: {
		url: "https://npm.elemecdn.com/lxgw-wenkai-screen-webfont@1.7.0/style.css",
		family: "'LXGW WenKai Screen', Inter, system-ui, sans-serif",
	},
};

interface ThemeCustomContextValue {
	themeConfig: ThemeConfig;
	pingEnabled: boolean;
	setPingEnabled: (next: boolean) => void;
}

const ThemeCustomContext = createContext<ThemeCustomContextValue>({
	themeConfig: PASSIVE_THEME_CONFIG,
	pingEnabled: false,
	setPingEnabled: () => {},
});

const PING_STORAGE_KEY = "nezha_ping_enabled";

export function ThemeCustomProvider({
	rawConfig,
	children,
}: {
	rawConfig?: Partial<ThemeConfig> | null;
	children: ReactNode;
}) {
	const themeConfig = useMemo(() => mergeThemeConfig(rawConfig), [rawConfig]);

	const [pingEnabled, setPingEnabledState] = useState<boolean>(() => {
		const stored = safeLocalStorage.getItem(PING_STORAGE_KEY);
		if (stored === "true") return true;
		if (stored === "false") return false;
		return themeConfig.ping_board.default_on;
	});

	useEffect(() => {
		const stored = safeLocalStorage.getItem(PING_STORAGE_KEY);
		if (stored === null) {
			setPingEnabledState(themeConfig.ping_board.default_on);
		}
	}, [themeConfig.ping_board.default_on]);

	const setPingEnabled = useCallback((next: boolean) => {
		setPingEnabledState(next);
		safeLocalStorage.setItem(PING_STORAGE_KEY, String(next));
	}, []);

	// Apply configured font stylesheet & font-family cleanly
	useEffect(() => {
		const preset = themeConfig.appearance.font_preset;
		let href = "";
		let family = "";

		if (preset === "misans" || preset === "lxgw") {
			href = FONT_PRESETS[preset].url;
			family = FONT_PRESETS[preset].family;
		} else if (preset === "custom") {
			href = themeConfig.appearance.custom_font_url.trim();
			family = themeConfig.appearance.custom_font_family.trim();
		}

		const linkId = "nz-custom-font-link";
		const existingLink = document.getElementById(linkId);
		if (href) {
			const linkEl =
				(existingLink as HTMLLinkElement | null) ||
				document.createElement("link");
			linkEl.id = linkId;
			linkEl.rel = "stylesheet";
			linkEl.href = href;
			if (!existingLink) document.head.appendChild(linkEl);
		} else if (existingLink) {
			existingLink.remove();
		}

		if (family) {
			document.documentElement.style.setProperty("--nz-custom-font", family);
			document.documentElement.classList.add("nz-has-custom-font");
		} else {
			document.documentElement.style.removeProperty("--nz-custom-font");
			document.documentElement.classList.remove("nz-has-custom-font");
		}
	}, [
		themeConfig.appearance.font_preset,
		themeConfig.appearance.custom_font_url,
		themeConfig.appearance.custom_font_family,
	]);

	// Apply background blur flag on document root
	useEffect(() => {
		document.documentElement.classList.toggle(
			"nz-bg-blur-enabled",
			themeConfig.appearance.background_blur,
		);
	}, [themeConfig.appearance.background_blur]);

	const value = useMemo(
		() => ({
			themeConfig,
			pingEnabled: themeConfig.ping_board.enabled && pingEnabled,
			setPingEnabled,
		}),
		[themeConfig, pingEnabled, setPingEnabled],
	);

	return (
		<ThemeCustomContext.Provider value={value}>
			{children}
		</ThemeCustomContext.Provider>
	);
}

export function useThemeConfig() {
	return useContext(ThemeCustomContext).themeConfig;
}

export function usePingBoardState() {
	const { themeConfig, pingEnabled, setPingEnabled } =
		useContext(ThemeCustomContext);
	return {
		featureEnabled: themeConfig.ping_board.enabled,
		refreshIntervalSec: themeConfig.ping_board.refresh_interval_sec,
		pingEnabled,
		setPingEnabled,
	};
}
