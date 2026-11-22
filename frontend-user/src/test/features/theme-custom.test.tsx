import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Footer from "@/components/Footer";
import { EarthGlobeModal } from "@/features/theme-custom/EarthGlobeModal";
import { GreetingOverview } from "@/features/theme-custom/GreetingOverview";
import {
	summarizeBackhaulRoutes,
	summarizeUnlockedMedia,
} from "@/features/theme-custom/inspection-api";
import { RemainingValueBadge } from "@/features/theme-custom/RemainingValueBadge";
import {
	applyExtraServerFilters,
	INITIAL_EXTRA_FILTER,
} from "@/features/theme-custom/ServerFilterExtras";
import ServerInspectionTab from "@/features/theme-custom/ServerInspectionTab";
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

const mockLoginUserState = vi.hoisted(() => ({
	data: null as { data?: { id: number; role?: number } } | null,
	isAuthenticated: false,
}));

vi.mock("@/hooks/use-login-user", () => ({
	useLoginUser: () => ({
		data: mockLoginUserState.data,
		isAuthenticated: mockLoginUserState.isAuthenticated,
		authStatus: mockLoginUserState.isAuthenticated
			? "authenticated"
			: "anonymous",
	}),
}));

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

	it("keeps EarthGlobeModal WebGL instance stable across live WebSocket server ticks", async () => {
		vi.useRealTimers();
		const origShowModal = HTMLDialogElement.prototype.showModal;
		const origClose = HTMLDialogElement.prototype.close;
		HTMLDialogElement.prototype.showModal = function showModalMock() {
			this.setAttribute("open", "");
		};
		HTMLDialogElement.prototype.close = function closeMock() {
			this.removeAttribute("open");
		};
		const destructorSpy = vi.fn();
		const pauseSpy = vi.fn();
		const controlsObj = { autoRotate: true, autoRotateSpeed: 0.6 };
		const globeInstance: Record<string, any> = {
			_destructor: destructorSpy,
			pauseAnimation: pauseSpy,
			resumeAnimation: vi.fn(),
			controls: () => controlsObj,
			renderer: () => ({ setPixelRatio: vi.fn() }),
		};
		for (const method of [
			"width",
			"height",
			"bumpImageUrl",
			"atmosphereAltitude",
			"atmosphereColor",
			"backgroundColor",
			"backgroundImageUrl",
			"globeImageUrl",
			"htmlLat",
			"htmlLng",
			"htmlElement",
			"htmlElementsData",
			"ringsData",
			"ringColor",
			"ringMaxRadius",
			"ringPropagationSpeed",
			"ringRepeatPeriod",
			"arcsData",
			"arcStartLat",
			"arcStartLng",
			"arcEndLat",
			"arcEndLng",
			"arcColor",
			"arcDashLength",
			"arcDashGap",
			"arcDashAnimateTime",
			"arcStroke",
			"arcAltitudeAutoScale",
			"pointOfView",
			"onGlobeReady",
		]) {
			globeInstance[method] = vi.fn(() => globeInstance);
		}
		const globeCtorSpy = vi.fn(() => () => globeInstance);
		(window as unknown as { Globe?: unknown }).Globe = globeCtorSpy;
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					latitude: 31.23,
					longitude: 121.47,
					city: "Shanghai",
				}),
				{ status: 200 },
			),
		);

		try {
			const s1 = createServer({ id: 1, name: "HK Node", country_code: "HK" });
			const { rerender, unmount } = render(
				<ThemeCustomProvider rawConfig={DEFAULT_THEME_CONFIG}>
					<EarthGlobeModal open onClose={() => {}} servers={[s1]} />
				</ThemeCustomProvider>,
			);

			await act(async () => {
				await Promise.resolve();
				await Promise.resolve();
			});

			expect(globeCtorSpy).toHaveBeenCalledTimes(1);
			expect(destructorSpy).toHaveBeenCalledTimes(0);

			// Simulate live WebSocket ticks with new server array & updated CPU/RAM stats
			const s1Tick2 = createServer({
				id: 1,
				name: "HK Node",
				country_code: "HK",
				state: { ...s1.state, cpu: 42.5, mem_used: 999999 },
			});
			rerender(
				<ThemeCustomProvider rawConfig={DEFAULT_THEME_CONFIG}>
					<EarthGlobeModal open onClose={() => {}} servers={[s1Tick2]} />
				</ThemeCustomProvider>,
			);

			await act(async () => {
				await Promise.resolve();
			});

			// Must NOT rebuild or destroy WebGL instance on CPU/RAM ticks
			expect(globeCtorSpy).toHaveBeenCalledTimes(1);
			expect(destructorSpy).toHaveBeenCalledTimes(0);

			unmount();
			expect(pauseSpy).toHaveBeenCalled();
			expect(destructorSpy).toHaveBeenCalledTimes(1);
		} finally {
			fetchSpy.mockRestore();
			delete (window as unknown as { Globe?: unknown }).Globe;
			HTMLDialogElement.prototype.showModal = origShowModal;
			HTMLDialogElement.prototype.close = origClose;
		}
	});

	it("filters and sorts servers by media unlock, expiry, and billing value", () => {
		const s1 = createServer({
			id: 101,
			name: "Tokyo GIA",
			country_code: "JP",
			public_note: JSON.stringify({
				billingDataMod: {
					endDate: "2026-05-10T00:00:00+08:00",
					autoRenewal: "0",
					cycle: "年",
					amount: "$100",
				},
			}),
		});
		const s2 = createServer({
			id: 102,
			name: "US Budget",
			country_code: "US",
			public_note: JSON.stringify({
				billingDataMod: {
					endDate: "2026-12-01T00:00:00+08:00",
					autoRenewal: "0",
					cycle: "年",
					amount: "$20",
				},
			}),
		});
		const summaries = {
			"101": {
				server_id: 101,
				running: false,
				unlocked: { netflix: "full", chatgpt: "yes" },
				regions: { netflix: "JP", chatgpt: "JP" },
				routes: { ct: "CN2 GIA", cu: "联通 AS9929", cm: "移动 CMI" },
			},
			"102": {
				server_id: 102,
				running: false,
				unlocked: { netflix: "no", chatgpt: "yes" },
				regions: { chatgpt: "US" },
				routes: { ct: "电信 163" },
			},
		};

		expect(summarizeUnlockedMedia(summaries["101"])).toContain("Netflix(JP)");
		expect(summarizeBackhaulRoutes(summaries["101"])).toContain("电信CN2 GIA");

		// Unlock filter: Netflix -> only s1
		const nfOnly = applyExtraServerFilters(
			[s1, s2],
			{ ...INITIAL_EXTRA_FILTER, unlockPlatforms: ["netflix"] },
			summaries,
		);
		expect(nfOnly.map((s) => s.id)).toEqual([101]);

		// Expiring within 30 days -> only s1 (May 10 vs system time May 1)
		const expiring = applyExtraServerFilters(
			[s1, s2],
			{ ...INITIAL_EXTRA_FILTER, expiring30d: true },
			summaries,
		);
		expect(expiring.map((s) => s.id)).toEqual([101]);

		// Search by route -> "9929" matches s1
		const byRoute = applyExtraServerFilters(
			[s1, s2],
			{ ...INITIAL_EXTRA_FILTER, query: "9929" },
			summaries,
		);
		expect(byRoute.map((s) => s.id)).toEqual([101]);

		// Sort by price_asc -> $20 (s2) before $100 (s1)
		const byPrice = applyExtraServerFilters(
			[s1, s2],
			{ ...INITIAL_EXTRA_FILTER, extraSort: "price_asc" },
			summaries,
		);
		expect(byPrice.map((s) => s.id)).toEqual([102, 101]);
	});

	it("hides inspection dispatch button for guests and non-admins, shows it only for admins", async () => {
		vi.useRealTimers();
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					success: true,
					data: { server_id: 1, running: false },
				}),
				{ status: 200 },
			),
		);
		try {
			// 1. Guest (anonymous)
			mockLoginUserState.data = null;
			mockLoginUserState.isAuthenticated = false;
			const guestView = renderWithProviders(
				<ThemeCustomProvider rawConfig={DEFAULT_THEME_CONFIG}>
					<ServerInspectionTab server_id={1} />
				</ThemeCustomProvider>,
			);
			await screen.findByText(/节点能力体检中心/);
			expect(
				screen.queryByRole("button", { name: /立即重新体检/ }),
			).not.toBeInTheDocument();
			guestView.unmount();

			// 2. Logged-in non-admin member (role = 1)
			mockLoginUserState.data = { data: { id: 2, role: 1 } };
			mockLoginUserState.isAuthenticated = true;
			const memberView = renderWithProviders(
				<ThemeCustomProvider rawConfig={DEFAULT_THEME_CONFIG}>
					<ServerInspectionTab server_id={1} />
				</ThemeCustomProvider>,
			);
			await screen.findByText(/节点能力体检中心/);
			expect(
				screen.queryByRole("button", { name: /立即重新体检/ }),
			).not.toBeInTheDocument();
			memberView.unmount();

			// 3. Logged-in admin (role = 0)
			mockLoginUserState.data = { data: { id: 1, role: 0 } };
			mockLoginUserState.isAuthenticated = true;
			renderWithProviders(
				<ThemeCustomProvider rawConfig={DEFAULT_THEME_CONFIG}>
					<ServerInspectionTab server_id={1} />
				</ThemeCustomProvider>,
			);
			expect(
				await screen.findByRole("button", { name: /立即重新体检/ }),
			).toBeInTheDocument();
		} finally {
			fetchSpy.mockRestore();
			mockLoginUserState.data = null;
			mockLoginUserState.isAuthenticated = false;
		}
	});
});
