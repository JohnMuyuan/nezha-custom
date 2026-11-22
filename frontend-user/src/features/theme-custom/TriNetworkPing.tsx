import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { NezhaMonitor } from "@/types/nezha-api";
import { usePingBoardState } from "./theme-config";

type IspKey = "ct" | "cu" | "cm";

interface ParsedPingItem {
	key: IspKey;
	label: string;
	ping: number;
}

interface GroupedPings {
	v4: Partial<Record<IspKey, ParsedPingItem>>;
	v6: Partial<Record<IspKey, ParsedPingItem>>;
}

function getIspInfo(name: string): { label: string; key: IspKey } | null {
	if (/电信|CT|Telecom/i.test(name)) return { label: "电信", key: "ct" };
	if (/联通|CU|Unicom/i.test(name)) return { label: "联通", key: "cu" };
	if (/移动|CM|Mobile/i.test(name)) return { label: "移动", key: "cm" };
	return null;
}

function extractLatestPing(monitor: NezhaMonitor): number {
	const delays = monitor.avg_delay ?? [];
	for (let i = delays.length - 1; i >= 0; i -= 1) {
		const val = delays[i];
		if (typeof val === "number" && val > 0) {
			return Number(val.toFixed(1));
		}
	}
	return 0;
}

function groupMonitors(monitors: NezhaMonitor[]): GroupedPings {
	const grouped: GroupedPings = { v4: {}, v6: {} };
	for (const m of monitors) {
		const name = m.monitor_name || "";
		const isp = getIspInfo(name);
		if (!isp) continue;
		const isV6 = /v6/i.test(name);
		grouped[isV6 ? "v6" : "v4"][isp.key] = {
			key: isp.key,
			label: isp.label,
			ping: extractLatestPing(m),
		};
	}
	return grouped;
}

export function TriNetworkPingSwitch({
	className,
	customBackgroundImage,
}: {
	className?: string;
	customBackgroundImage?: string;
}) {
	const { featureEnabled, pingEnabled, setPingEnabled } = usePingBoardState();
	const switchId = useId();

	if (!featureEnabled) return null;

	return (
		<label
			htmlFor={switchId}
			className={cn(
				"inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-2 rounded-full border px-2.5 text-xs font-semibold transition-colors",
				pingEnabled
					? "border-blue-500/40 bg-blue-500/15 text-blue-600 dark:text-blue-400"
					: "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700/80",
				customBackgroundImage &&
					!pingEnabled &&
					"bg-white/75 dark:bg-stone-800/80",
				className,
			)}
		>
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				aria-hidden="true"
			>
				<path d="M5 12.55a11 11 0 0 1 14.08 0" />
				<path d="M1.42 9a16 16 0 0 1 21.16 0" />
				<path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
				<line x1="12" y1="20" x2="12.01" y2="20" />
			</svg>
			<span className="whitespace-nowrap">三网实时延迟</span>
			<span className="relative inline-flex h-4 w-7 items-center">
				<input
					id={switchId}
					type="checkbox"
					role="switch"
					aria-checked={pingEnabled}
					checked={pingEnabled}
					onChange={(e) => setPingEnabled(e.target.checked)}
					className="peer sr-only"
				/>
				<span className="h-4 w-7 rounded-full bg-stone-300 transition-colors peer-checked:bg-blue-500 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-500 dark:bg-stone-600" />
				<span className="pointer-events-none absolute left-0.5 h-3 w-3 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-3" />
			</span>
		</label>
	);
}

const ISP_ORDER: IspKey[] = ["ct", "cu", "cm"];
const ISP_COLOR_CLASSES: Record<IspKey, { dot: string; text: string }> = {
	ct: { dot: "bg-blue-500", text: "text-blue-500" },
	cu: { dot: "bg-orange-500", text: "text-orange-500" },
	cm: { dot: "bg-green-500", text: "text-green-500" },
};

export const CardPingBoard = memo(function CardPingBoard({
	serverId,
}: {
	serverId: number;
}) {
	const { pingEnabled, refreshIntervalSec } = usePingBoardState();
	const containerRef = useRef<HTMLDivElement>(null);
	const abortRef = useRef<AbortController | null>(null);
	const [isVisible, setIsVisible] = useState(false);
	const [grouped, setGrouped] = useState<GroupedPings | null>(null);

	useEffect(() => {
		if (!pingEnabled) {
			setGrouped(null);
			return;
		}
		const el = containerRef.current;
		if (!el || typeof IntersectionObserver === "undefined") {
			setIsVisible(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					setIsVisible(entry.isIntersecting);
				}
			},
			{ rootMargin: "50px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [pingEnabled]);

	const fetchPing = useCallback(async () => {
		if (!pingEnabled) return;
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const res = await fetch(`/api/v1/server/${serverId}/service?period=1d`, {
				credentials: "same-origin",
				signal: controller.signal,
			});
			if (!res.ok) return;
			const json = (await res.json()) as {
				data?: NezhaMonitor[] | Record<string, NezhaMonitor>;
			};
			const list = json?.data
				? Array.isArray(json.data)
					? json.data
					: Object.values(json.data)
				: [];
			if (list.length > 0 && !controller.signal.aborted) {
				setGrouped(groupMonitors(list));
			}
		} catch {
			// Ignore aborted or transient fetch errors
		}
	}, [pingEnabled, serverId]);

	useEffect(() => {
		if (!pingEnabled || !isVisible) return;
		void fetchPing();
		const ms = Math.max(5, refreshIntervalSec) * 1000;
		const timer = setInterval(() => {
			if (document.visibilityState === "visible") {
				void fetchPing();
			}
		}, ms);
		return () => {
			clearInterval(timer);
			abortRef.current?.abort();
		};
	}, [pingEnabled, isVisible, refreshIntervalSec, fetchPing]);

	if (!pingEnabled) return null;

	const hasV4 = grouped && Object.keys(grouped.v4).length > 0;
	const hasV6 = grouped && Object.keys(grouped.v6).length > 0;

	return (
		<div
			ref={containerRef}
			className={cn(
				"w-full",
				(hasV4 || hasV6) &&
					"mt-1 flex flex-col gap-1 border-t border-dashed border-border/60 pt-2",
			)}
			onClick={(e) => e.stopPropagation()}
		>
			{(["v4", "v6"] as const).map((ver) => {
				const bucket = grouped?.[ver];
				if (!bucket || Object.keys(bucket).length === 0) return null;
				return (
					<div
						key={ver}
						className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1"
					>
						<span
							className={cn(
								"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none text-white",
								ver === "v4" ? "bg-sky-500" : "bg-violet-500",
							)}
						>
							{ver === "v4" ? "IPv4" : "IPv6"}
						</span>
						<div className="flex flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5">
							{ISP_ORDER.map((ispKey) => {
								const item = bucket[ispKey];
								if (!item) return null;
								const isTimeout = item.ping <= 0;
								return (
									<div
										key={ispKey}
										className="flex items-center gap-1 font-mono text-[11px]"
									>
										<span
											className={cn(
												"h-1.5 w-1.5 rounded-full",
												ISP_COLOR_CLASSES[ispKey].dot,
											)}
										/>
										<span
											className={cn(
												"font-semibold",
												ISP_COLOR_CLASSES[ispKey].text,
											)}
										>
											{item.label}
										</span>
										<span
											className={cn(
												"font-bold",
												isTimeout ? "text-destructive" : "text-foreground",
											)}
										>
											{isTimeout ? "超时" : `${item.ping}ms`}
										</span>
									</div>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
});
