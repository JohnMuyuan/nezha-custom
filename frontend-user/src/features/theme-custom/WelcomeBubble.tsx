import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useThemeConfig } from "./theme-config";

interface VisitorInfo {
	locationText: string;
	os: string;
	browser: string;
	ip: string;
	isp: string;
	dateStr: string;
}

function detectOS(ua: string): string {
	if (/android/i.test(ua)) return "Android";
	if (/iPad|iPhone|iPod/.test(ua)) return "iOS";
	if (/macintosh|mac os x/i.test(ua)) return "macOS";
	if (/windows phone/i.test(ua)) return "Windows Phone";
	if (/windows/i.test(ua)) return "Windows";
	if (/linux/i.test(ua)) return "Linux";
	return "未知设备";
}

function detectBrowser(ua: string): string {
	if (ua.includes("Edg")) return "Edge";
	if (ua.includes("Firefox")) return "Firefox";
	if (ua.includes("Chrome")) return "Chrome";
	if (ua.includes("Safari")) return "Safari";
	return "未知浏览器";
}

function OsIcon({ os }: { os: string }) {
	const lower = os.toLowerCase();
	if (lower.includes("windows")) {
		return (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="currentColor"
				aria-hidden="true"
			>
				<path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
			</svg>
		);
	}
	if (lower.includes("mac") || lower.includes("ios")) {
		return (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="currentColor"
				aria-hidden="true"
			>
				<path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
			</svg>
		);
	}
	if (lower.includes("android")) {
		return (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="currentColor"
				aria-hidden="true"
			>
				<path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 0 0-.83.22l-1.88 3.24a11.43 11.43 0 0 0-8.94 0L5.65 5.67a.643.643 0 0 0-.87-.2c-.28.18-.37.54-.22.83L6.4 9.48A10.81 10.81 0 0 0 1 18h22a10.81 10.81 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
			</svg>
		);
	}
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
			<line x1="8" y1="21" x2="16" y2="21" />
			<line x1="12" y1="17" x2="12" y2="21" />
		</svg>
	);
}

export function WelcomeBubble() {
	const { welcome_bubble, appearance } = useThemeConfig();
	const [visible, setVisible] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const [ipHidden, setIpHidden] = useState(false);
	const [ispHidden, setIspHidden] = useState(false);
	const [info, setInfo] = useState<VisitorInfo>(() => ({
		locationText: "正在定位中...",
		os: detectOS(navigator.userAgent),
		browser: detectBrowser(navigator.userAgent),
		ip: "",
		isp: "",
		dateStr: new Date().toLocaleDateString("zh-CN", {
			year: "numeric",
			month: "long",
			day: "numeric",
			timeZone: "Asia/Shanghai",
		}),
	}));

	useEffect(() => {
		if (!welcome_bubble.enabled || dismissed) return;
		let cancelled = false;
		let showTimer: ReturnType<typeof setTimeout> | undefined;
		let closeTimer: ReturnType<typeof setTimeout> | undefined;

		const loadGeo = async () => {
			let city = "";
			let region = "";
			let country = "";
			let isp = "";
			let ip = "";

			const strategies: Array<{
				url: string;
				parse: (j: Record<string, unknown>) => {
					country?: string;
					region?: string;
					city?: string;
					isp?: string;
					ip?: string;
				} | null;
			}> = [
				{
					url: "https://api.ip.sb/geoip",
					parse: (j) =>
						"country" in j
							? {
									country: String(j.country ?? ""),
									region: String(j.region ?? ""),
									city: String(j.city ?? ""),
									isp: String(j.asn_organization ?? ""),
									ip: String(j.ip ?? ""),
								}
							: null,
				},
				{
					url: "https://ipwho.is",
					parse: (j) => {
						if (j.success !== true) return null;
						const conn = (j.connection as Record<string, unknown>) || {};
						return {
							country: String(j.country ?? ""),
							region: String(j.region ?? ""),
							city: String(j.city ?? ""),
							isp: String(conn.isp ?? ""),
							ip: String(j.ip ?? ""),
						};
					},
				},
				{
					url: "https://api.ipapi.is",
					parse: (j) => {
						if (!j.location || typeof j.location !== "object") return null;
						const loc = j.location as Record<string, unknown>;
						const comp = (j.company as Record<string, unknown>) || {};
						const dc = (j.datacenter as Record<string, unknown>) || {};
						return {
							country: String(loc.country ?? ""),
							region: String(loc.state ?? ""),
							city: String(loc.city ?? ""),
							isp: String(comp.name || dc.datacenter || ""),
							ip: String(j.ip ?? ""),
						};
					},
				},
			];

			for (const s of strategies) {
				try {
					const res = await fetch(s.url, {
						signal: AbortSignal.timeout(4500),
					});
					if (!res.ok) continue;
					const data = (await res.json()) as Record<string, unknown>;
					const mapped = s.parse(data);
					if (mapped?.ip) {
						country = mapped.country || country;
						region = mapped.region || region;
						city = mapped.city || city;
						isp = mapped.isp || isp;
						ip = mapped.ip;
						break;
					}
				} catch {
					// Try next provider
				}
			}

			if (cancelled) return;

			let locationText = "欢迎你，朋友！";
			if (city && region) {
				locationText = `欢迎来自 ${region}, ${city} 的朋友！`;
			} else if (country) {
				locationText = `欢迎来自 ${country} 的朋友！`;
			}

			setInfo((prev) => ({
				...prev,
				locationText,
				ip,
				isp,
			}));

			showTimer = setTimeout(() => {
				if (cancelled) return;
				setVisible(true);
				if (welcome_bubble.auto_close_ms > 0) {
					closeTimer = setTimeout(() => {
						if (!cancelled) setVisible(false);
					}, welcome_bubble.auto_close_ms);
				}
			}, 700);
		};

		void loadGeo();

		return () => {
			cancelled = true;
			if (showTimer) clearTimeout(showTimer);
			if (closeTimer) clearTimeout(closeTimer);
		};
	}, [welcome_bubble.enabled, welcome_bubble.auto_close_ms, dismissed]);

	if (!welcome_bubble.enabled || !visible || dismissed) return null;

	const logoSrc = appearance.custom_logo || "/apple-touch-icon.png";

	return (
		<aside role="status" aria-live="polite" className="nz-welcome-bubble">
			<div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
				<div className="flex items-center gap-2 text-sm font-bold text-primary">
					<img
						src={logoSrc}
						alt=""
						className="h-5 w-5 rounded-full object-cover"
						onError={(e) => {
							e.currentTarget.style.display = "none";
						}}
					/>
					<span>{welcome_bubble.title || "Hello!"}</span>
				</div>
				<button
					type="button"
					aria-label="关闭欢迎气泡"
					onClick={() => {
						setDismissed(true);
						setVisible(false);
					}}
					className="rounded-md p-1 text-muted-foreground transition-transform hover:rotate-90 hover:text-foreground"
				>
					<X className="h-4 w-4" />
				</button>
			</div>
			<div className="space-y-1.5 p-4 text-[13px]">
				<p className="font-semibold text-primary">{info.locationText}</p>
				<div className="flex items-center gap-2 text-muted-foreground">
					<OsIcon os={info.os} />
					<span className="text-foreground">{info.os}</span>
				</div>
				<div className="flex items-center gap-2 text-muted-foreground">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="10" />
						<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
						<path d="M2 12h20" />
					</svg>
					<span className="text-foreground">{info.browser}</span>
				</div>
				{info.ip && (
					<div className="flex items-center gap-2 text-muted-foreground">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
						>
							<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
							<circle cx="12" cy="10" r="3" />
						</svg>
						<button
							type="button"
							title="点击隐藏或显示 IP"
							onClick={() => setIpHidden((v) => !v)}
							className={`text-left text-foreground ${ipHidden ? "nz-spoiler" : ""}`}
						>
							{info.ip}
						</button>
					</div>
				)}
				{info.isp && (
					<div className="flex items-center gap-2 text-muted-foreground">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
						>
							<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
						</svg>
						<button
							type="button"
							title="点击隐藏或显示运营商"
							onClick={() => setIspHidden((v) => !v)}
							className={`truncate text-left text-foreground ${ispHidden ? "nz-spoiler" : ""}`}
						>
							{info.isp}
						</button>
					</div>
				)}
				<div className="flex items-center gap-2 text-muted-foreground">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="10" />
						<polyline points="12 6 12 12 16 14" />
					</svg>
					<span className="text-foreground">{info.dateStr}</span>
				</div>
			</div>
		</aside>
	);
}
