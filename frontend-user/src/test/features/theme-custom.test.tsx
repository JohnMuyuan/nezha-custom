import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Footer from "@/components/Footer";
import { GreetingOverview } from "@/features/theme-custom/GreetingOverview";
import { RemainingValueBadge } from "@/features/theme-custom/RemainingValueBadge";
import {
	formatFileSizeParts,
	getTrafficGradientColor,
	parseServerBilling,
} from "@/features/theme-custom/server-billing";
import {
	DEFAULT_THEME_CONFIG,
	mergeThemeConfig,
	ThemeCustomProvider,
} from "@/features/theme-custom/theme-config";
import { createServer } from "@/test/fixtures";
import { renderWithProviders } from "@/test/utils";

vi.mock("@/lib/nezha-api", () => ({
	fetchSetting: vi.fn().mockResolvedValue({
		success: true,
		data: {
			config: {
				debug: false,
				language: "zh-CN",
				site_name: "Nezha Custom",
				user_template: "user-dist",
				admin_template: "admin-dist",
				custom_code: "",
			},
			version: "v2.7.0",
		},
	}),
	fetchService: vi.fn().mockResolvedValue({
		success: true,
		data: { services: {}, cycle_transfer_stats: {} },
	}),
}));

describe("Theme Custom Enhancements", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-01T10:00:00+08:00"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("parses billing data and calculates remaining value accurately", () => {
		const server = createServer({
			id: 42,
			name: "HK GIA Node",
			country_code: "HK",
			public_note: JSON.stringify({
				billingDataMod: {
					startDate: "2026-01-01T00:00:00+08:00",
					endDate: "2026-10-28T00:00:00+08:00",
					autoRenewal: "0",
					cycle: "年",
					amount: "$100",
				},
				planDataMod: {
					bandwidth: "1Gbps",
					trafficVol: "2TB/Month",
					trafficType: "2",
					IPv4: "1",
					IPv6: "1",
					networkRoute: "CN2 GIA",
					extra: "DemoHost",
				},
			}),
		});

		const parsed = parseServerBilling(server, "$");
		expect(parsed).not.toBeNull();
		expect(parsed?.currencyCode).toBe("USD");
		expect(parsed?.price).toBe(100);
		expect(parsed?.period).toBe("year");
		expect(parsed?.remainingDays).toBeGreaterThan(170);
		expect(parsed?.remainingValue).toBeGreaterThan(45);
		expect(parsed?.merchant).toBe("DemoHost");
	});

	it("renders RemainingValueBadge when enabled via ThemeCustomProvider", () => {
		const server = createServer({
			id: 7,
			name: "US Node",
			public_note: JSON.stringify({
				billingDataMod: {
					startDate: "2026-04-01T00:00:00+08:00",
					endDate: "2026-05-16T00:00:00+08:00",
					autoRenewal: "0",
					cycle: "月",
					amount: "$30",
				},
			}),
		});

		render(
			<ThemeCustomProvider rawConfig={DEFAULT_THEME_CONFIG}>
				<RemainingValueBadge server={server} />
			</ThemeCustomProvider>,
		);

		expect(screen.getByText(/剩余\$15\.00/)).toBeInTheDocument();
	});

	it("renders holiday greeting and live uptime in GreetingOverview", () => {
		render(
			<ThemeCustomProvider rawConfig={DEFAULT_THEME_CONFIG}>
				<GreetingOverview />
			</ThemeCustomProvider>,
		);

		// 2026-05-01 is Labor Day in HOLIDAY_GREETINGS
		expect(screen.getByText(/劳动节|五一/)).toBeInTheDocument();
		expect(screen.getByText(/网站已运行/)).toBeInTheDocument();
	});

	it("hides Footer when theme_config.appearance.hide_footer is true", () => {
		const { container } = renderWithProviders(
			<ThemeCustomProvider
				rawConfig={{
					...DEFAULT_THEME_CONFIG,
					appearance: { ...DEFAULT_THEME_CONFIG.appearance, hide_footer: true },
				}}
			>
				<Footer />
			</ThemeCustomProvider>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("formats file size and gradient color helper cleanly", () => {
		expect(formatFileSizeParts(1024 * 1024)).toEqual({
			value: "1.00",
			unit: "MB",
		});
		expect(getTrafficGradientColor(0)).toMatch(/^hsl\(/);
		expect(getTrafficGradientColor(95)).toMatch(/^hsl\(/);
		expect(mergeThemeConfig(undefined).dock.enabled).toBe(false);
		expect(mergeThemeConfig({}).dock.enabled).toBe(true);
	});
});
