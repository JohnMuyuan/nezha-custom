import { Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { NezhaServer } from "@/types/nezha-api";
import { CustomModalDialog } from "./CustomModalDialog";
import { useThemeConfig } from "./theme-config";

const COORD_MAP: Record<string, [number, number]> = {
	CN: [35.8617, 104.1954],
	HK: [22.3193, 114.1694],
	TW: [23.6978, 120.9605],
	MO: [22.1987, 113.5439],
	JP: [36.2048, 138.2529],
	KR: [35.9078, 127.7669],
	SG: [1.3521, 103.8198],
	US: [37.0902, -95.7129],
	GB: [55.3781, -3.436],
	DE: [51.1657, 10.4515],
	FR: [46.2276, 2.2137],
	NL: [52.1326, 5.2913],
	RU: [61.524, 105.3188],
	AU: [-25.2744, 133.7751],
	CA: [56.1304, -106.3468],
	IN: [20.5937, 78.9629],
	BR: [-14.235, -51.9253],
	ZA: [-30.5595, 22.9375],
	IT: [41.8719, 12.5674],
	CH: [46.8182, 8.2275],
	SE: [60.1282, 18.6435],
	TR: [38.9637, 35.2433],
	AE: [23.4241, 53.8478],
	ES: [40.4637, -3.7492],
	FI: [61.9241, 25.7482],
	KP: [40.3399, 127.5101],
	MN: [46.8625, 103.8467],
	TH: [15.87, 100.9925],
	VN: [14.0583, 108.2772],
	ID: [-0.7893, 113.9213],
	MY: [4.2105, 101.9758],
	PH: [12.8797, 121.774],
	AR: [-38.4161, -63.6167],
	IE: [53.4129, -8.2439],
	PL: [51.9194, 19.1451],
	RO: [45.9432, 24.9668],
	AT: [47.5162, 14.5501],
	CZ: [49.8175, 15.473],
	BG: [42.7339, 25.4858],
	DK: [56.2639, 9.5018],
	NO: [60.472, 8.4689],
};

const KEYWORD_ZH: Record<string, string> = {
	洛杉矶: "US",
	圣何塞: "US",
	旧金山: "US",
	纽约: "US",
	西雅图: "US",
	美国: "US",
	香港: "HK",
	台湾: "TW",
	台北: "TW",
	东京: "JP",
	大阪: "JP",
	日本: "JP",
	首尔: "KR",
	韩国: "KR",
	新加坡: "SG",
	狮城: "SG",
	北京: "CN",
	上海: "CN",
	广州: "CN",
	深圳: "CN",
	中国: "CN",
	伦敦: "GB",
	英国: "GB",
	法兰克福: "DE",
	德国: "DE",
	巴黎: "FR",
	法国: "FR",
	阿姆斯特丹: "NL",
	荷兰: "NL",
	悉尼: "AU",
	澳洲: "AU",
	加拿大: "CA",
	印度: "IN",
	巴西: "BR",
	俄罗斯: "RU",
	意大利: "IT",
	瑞士: "CH",
	瑞典: "SE",
	土耳其: "TR",
	芬兰: "FI",
	波兰: "PL",
};

function resolveCountryCode(server: NezhaServer): string {
	const raw = (server.country_code || "").trim().toUpperCase();
	if (/^[A-Z]{2}$/.test(raw) && COORD_MAP[raw]) return raw;
	for (const [kw, code] of Object.entries(KEYWORD_ZH)) {
		if (server.name.includes(kw)) return code;
	}
	return "UN";
}

function getFlagUrl(code: string): string {
	return `https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/${code.toLowerCase()}.svg`;
}

type GlobeFactory = () => (
	el: HTMLElement,
) => Record<string, (...args: unknown[]) => unknown>;

function loadGlobeCdn(): Promise<GlobeFactory> {
	const win = window as unknown as { Globe?: GlobeFactory };
	if (win.Globe) return Promise.resolve(win.Globe);

	const sources = [
		"https://cdn.jsdelivr.net/npm/globe.gl",
		"https://unpkg.com/globe.gl",
	];
	return new Promise((resolve, reject) => {
		const trySource = (index: number) => {
			if (win.Globe) return resolve(win.Globe);
			if (index >= sources.length) {
				return reject(new Error("Globe.gl 加载失败，请检查网络"));
			}
			const script = document.createElement("script");
			const timer = setTimeout(() => {
				script.remove();
				trySource(index + 1);
			}, 10000);
			script.src = sources[index];
			script.async = true;
			script.onload = () => {
				clearTimeout(timer);
				if (win.Globe) resolve(win.Globe);
				else trySource(index + 1);
			};
			script.onerror = () => {
				clearTimeout(timer);
				script.remove();
				trySource(index + 1);
			};
			document.head.appendChild(script);
		};
		trySource(0);
	});
}

function getIsDarkMode(): boolean {
	if (document.documentElement.classList.contains("dark")) return true;
	if (document.documentElement.classList.contains("light")) return false;
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function EarthGlobeModal({
	open,
	onClose,
	servers,
}: {
	open: boolean;
	onClose: () => void;
	servers: NezhaServer[];
}) {
	const { earth_globe, appearance } = useThemeConfig();
	const titleId = useId();
	const renderRef = useRef<HTMLDivElement>(null);
	const [loading, setLoading] = useState(false);
	const [errorMsg, setErrorMsg] = useState("");
	const [tooltipData, setTooltipData] = useState<{
		title: string;
		items: string[];
	} | null>(null);

	useEffect(() => {
		if (!open) {
			setTooltipData(null);
			return;
		}
		let cancelled = false;
		let globeInstance: any = null;
		let resizeHandler: (() => void) | undefined;
		let mediaQuery: MediaQueryList | undefined;
		let mediaHandler: (() => void) | undefined;

		const init = async () => {
			const host = renderRef.current;
			if (!host) return;
			setLoading(true);
			setErrorMsg("");

			try {
				let userGeo = { lat: 35.8617, lng: 104.1954, city: "Your Location" };
				const [GlobeCtor] = await Promise.all([
					loadGlobeCdn(),
					fetch("https://api.ip.sb/geoip", {
						signal: AbortSignal.timeout(3000),
					})
						.then((r) => (r.ok ? r.json() : null))
						.then(
							(
								d: {
									latitude?: number;
									longitude?: number;
									city?: string;
								} | null,
							) => {
								if (d?.latitude && d?.longitude) {
									userGeo = {
										lat: d.latitude,
										lng: d.longitude,
										city: d.city || "Your Location",
									};
								}
							},
						)
						.catch(() => undefined),
				]);

				if (cancelled || !renderRef.current) return;

				const groups: Record<string, string[]> = {};
				for (const srv of servers) {
					const code = resolveCountryCode(srv);
					if (!groups[code]) groups[code] = [];
					groups[code].push(srv.name);
				}

				const pointsData: Array<{
					code: string;
					lat: number;
					lng: number;
					servers: string[];
					type: "server" | "user";
				}> = Object.entries(groups).map(([code, list]) => {
					const coords = COORD_MAP[code] || [0, 0];
					return {
						code,
						lat: coords[0],
						lng: coords[1],
						servers: list,
						type: "server",
					};
				});

				pointsData.push({
					code: "USER",
					lat: userGeo.lat,
					lng: userGeo.lng,
					servers: [userGeo.city],
					type: "user",
				});

				const arcsData = pointsData
					.filter((p) => p.type === "server" && p.code !== "UN")
					.map((p) => ({
						startLat: p.lat,
						startLng: p.lng,
						endLat: userGeo.lat,
						endLng: userGeo.lng,
					}));

				const applyTheme = (instance: typeof globeInstance) => {
					const isDark = getIsDarkMode();
					const accent = isDark ? "#60a5fa" : "#3b82f6";
					instance
						.backgroundColor("rgba(0,0,0,0)")
						.backgroundImageUrl(
							isDark
								? "//upload.wikimedia.org/wikipedia/commons/6/60/ESO_-_Milky_Way.jpg"
								: null,
						)
						.globeImageUrl(
							isDark
								? "//upload.wikimedia.org/wikipedia/commons/b/b3/Solarsystemscope_texture_8k_earth_nightmap.jpg"
								: "//upload.wikimedia.org/wikipedia/commons/0/04/Solarsystemscope_texture_8k_earth_daymap.jpg",
						)
						.atmosphereColor(isDark ? accent : "rgba(59, 130, 246, 0.25)");
				};

				host.innerHTML = "";
				globeInstance = (GlobeCtor as any)()(host)
					.width(host.clientWidth || 720)
					.height(host.clientHeight || 520)
					.bumpImageUrl(
						"//upload.wikimedia.org/wikipedia/commons/b/b3/Solarsystemscope_texture_8k_earth_nightmap.jpg",
					)
					.atmosphereAltitude(0.15)
					.htmlElementsData(pointsData)
					.htmlLat((d: { lat: number }) => d.lat)
					.htmlLng((d: { lng: number }) => d.lng)
					.htmlElement(
						(d: {
							code: string;
							servers: string[];
							type: "server" | "user";
						}) => {
							const wrapper = document.createElement("div");
							if (d.type === "user") {
								const marker = document.createElement("div");
								marker.className = "nz-earth-user-marker";
								const img = document.createElement("img");
								img.src = appearance.custom_logo || "/apple-touch-icon.png";
								img.alt = "You";
								img.style.width = "100%";
								img.style.height = "100%";
								img.style.objectFit = "cover";
								img.onerror = () => {
									img.style.display = "none";
								};
								marker.appendChild(img);
								marker.onclick = (e) => {
									e.stopPropagation();
									globeInstance.controls().autoRotate = false;
									setTooltipData({ title: "YOU", items: d.servers });
								};
								wrapper.appendChild(marker);
							} else {
								const img = document.createElement("img");
								img.src =
									d.code === "UN"
										? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"><circle cx="12" cy="12" r="10"/><text x="12" y="16" font-size="14" text-anchor="middle" fill="white">?</text></svg>'
										: getFlagUrl(d.code);
								img.alt = d.code;
								img.style.width = "24px";
								img.style.cursor = "pointer";
								img.style.pointerEvents = "auto";
								img.style.transform = "translate(-50%, -50%)";
								img.style.filter = "drop-shadow(0 0 4px #3b82f6)";
								img.onclick = (e) => {
									e.stopPropagation();
									globeInstance.controls().autoRotate = false;
									setTooltipData({
										title: `${d.code === "UN" ? "未知地区" : d.code} (${d.servers.length})`,
										items: d.servers,
									});
								};
								wrapper.appendChild(img);
							}
							return wrapper;
						},
					)
					.ringsData(pointsData.filter((p) => p.type === "server"))
					.ringColor(() => "#3b82f6")
					.ringMaxRadius(2)
					.ringPropagationSpeed(1)
					.ringRepeatPeriod(1250)
					.arcsData(arcsData)
					.arcStartLat((d: { startLat: number }) => d.startLat)
					.arcStartLng((d: { startLng: number }) => d.startLng)
					.arcEndLat((d: { endLat: number }) => d.endLat)
					.arcEndLng((d: { endLng: number }) => d.endLng)
					.arcColor(() => "#3b82f6")
					.arcDashLength(0.5)
					.arcDashGap(1)
					.arcDashAnimateTime(1750)
					.arcStroke(0.8)
					.arcAltitudeAutoScale(0.5);

				applyTheme(globeInstance);

				const isMobile = window.innerWidth <= 768;
				globeInstance.pointOfView({
					lat: userGeo.lat,
					lng: userGeo.lng,
					altitude: isMobile ? 3.0 : 2.0,
				});
				globeInstance.controls().autoRotate = earth_globe.auto_rotate_speed > 0;
				globeInstance.controls().autoRotateSpeed =
					earth_globe.auto_rotate_speed;

				resizeHandler = () => {
					if (renderRef.current && globeInstance) {
						globeInstance
							.width(renderRef.current.clientWidth)
							.height(renderRef.current.clientHeight);
					}
				};
				window.addEventListener("resize", resizeHandler);

				mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
				mediaHandler = () => {
					if (globeInstance) applyTheme(globeInstance);
				};
				mediaQuery.addEventListener("change", mediaHandler);
			} catch (err) {
				if (!cancelled) {
					setErrorMsg(
						err instanceof Error ? err.message : "地球数据加载失败，请检查网络",
					);
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		};

		void init();

		return () => {
			cancelled = true;
			if (resizeHandler) window.removeEventListener("resize", resizeHandler);
			if (mediaQuery && mediaHandler) {
				mediaQuery.removeEventListener("change", mediaHandler);
			}
			if (globeInstance && typeof globeInstance._destructor === "function") {
				globeInstance._destructor();
			}
		};
	}, [open, servers, earth_globe.auto_rotate_speed, appearance.custom_logo]);

	return (
		<CustomModalDialog
			open={open}
			onClose={onClose}
			labelledBy={titleId}
			className="h-[84dvh] w-[90vw] max-w-[1160px]"
		>
			<div className="relative flex h-full w-full flex-col overflow-hidden">
				{/* Floating header overlay */}
				<div className="pointer-events-none absolute left-4 top-4 z-20 rounded-xl border border-border/60 bg-card/85 px-4 py-2.5 shadow-md backdrop-blur-md">
					<h2
						id={titleId}
						className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
					>
						Total Servers
					</h2>
					<div className="text-2xl font-extrabold leading-tight text-blue-500">
						{servers.length}
					</div>
				</div>

				<button
					type="button"
					aria-label="关闭 3D 节点地球"
					onClick={onClose}
					className="absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded-full border border-border/60 bg-card/85 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-md backdrop-blur-md hover:text-foreground"
				>
					<X className="h-4 w-4" />
					关闭
				</button>

				{loading && (
					<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-card/40 backdrop-blur-xs">
						<Loader2 className="h-7 w-7 animate-spin text-blue-500" />
						<span className="text-xs text-muted-foreground">
							正在加载 3D 节点地球...
						</span>
					</div>
				)}

				{errorMsg && (
					<div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-destructive">
						{errorMsg}
					</div>
				)}

				<div
					ref={renderRef}
					onClick={() => setTooltipData(null)}
					className="h-full w-full flex-1 cursor-grab active:cursor-grabbing"
				/>

				{tooltipData && (
					<div className="absolute bottom-5 left-1/2 z-20 max-h-[220px] w-[280px] max-w-[calc(100%-32px)] -translate-x-1/2 overflow-hidden rounded-xl border border-blue-500/70 bg-card/95 p-3.5 shadow-xl backdrop-blur-md">
						<div className="mb-2 flex items-center justify-between border-b border-border/50 pb-1.5 text-sm font-bold text-blue-500">
							<span>{tooltipData.title}</span>
							<button
								type="button"
								aria-label="关闭节点列表"
								onClick={() => setTooltipData(null)}
								className="text-muted-foreground hover:text-foreground"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						</div>
						<ul className="nz-thin-scroll max-h-[145px] space-y-1 overflow-y-auto text-xs">
							{tooltipData.items.map((name, idx) => (
								<li key={idx} className="flex items-center gap-1.5">
									<span className="text-blue-500">•</span>
									<span className="truncate">{name}</span>
								</li>
							))}
						</ul>
					</div>
				)}
			</div>
		</CustomModalDialog>
	);
}
