import { useQuery } from "@tanstack/react-query";
import { memo, useMemo, useSyncExternalStore } from "react";
import { fetchService } from "@/lib/nezha-api";
import {
	calculateRemainingDaysUntil,
	extractCycleTrafficMap,
	formatFileSizeParts,
	formatShortDate,
	getTrafficGradientColor,
} from "./server-billing";
import { useThemeConfig } from "./theme-config";

interface SlideTickerState {
	slideIndex: number;
	fading: boolean;
}

// Single shared clock across ALL server cards (1 timer instead of N timers)
class SharedTrafficTicker {
	private state: SlideTickerState = { slideIndex: 0, fading: false };
	private listeners = new Set<() => void>();
	private intervalTimer: ReturnType<typeof setInterval> | null = null;
	private swapTimer: ReturnType<typeof setTimeout> | null = null;
	private intervalMs = 5000;
	private durationMs = 500;
	private visBound = false;

	private handleVisibility = () => {
		if (document.visibilityState === "visible") {
			this.ensureRunning();
		} else {
			this.stopTimers();
			if (this.state.fading) {
				this.state = { ...this.state, fading: false };
				this.emit();
			}
		}
	};

	private emit() {
		for (const listener of this.listeners) {
			listener();
		}
	}

	private stopTimers() {
		if (this.intervalTimer !== null) {
			clearInterval(this.intervalTimer);
			this.intervalTimer = null;
		}
		if (this.swapTimer !== null) {
			clearTimeout(this.swapTimer);
			this.swapTimer = null;
		}
	}

	private ensureRunning() {
		this.stopTimers();
		if (this.listeners.size === 0 || this.intervalMs <= 0) return;
		if (
			typeof document !== "undefined" &&
			document.visibilityState === "hidden"
		) {
			return;
		}
		const reducedMotion =
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const halfDuration = reducedMotion
			? 0
			: Math.max(0, Math.floor(this.durationMs / 2));

		this.intervalTimer = setInterval(() => {
			if (
				typeof document !== "undefined" &&
				document.visibilityState === "hidden"
			) {
				return;
			}
			if (halfDuration > 0) {
				this.state = { ...this.state, fading: true };
				this.emit();
				this.swapTimer = setTimeout(() => {
					this.state = {
						slideIndex: (this.state.slideIndex + 1) % 4,
						fading: false,
					};
					this.emit();
				}, halfDuration);
			} else {
				this.state = {
					slideIndex: (this.state.slideIndex + 1) % 4,
					fading: false,
				};
				this.emit();
			}
		}, this.intervalMs);
	}

	configure(intervalMs: number, durationMs: number) {
		const nextInterval = Math.max(0, intervalMs);
		const nextDuration = Math.max(0, durationMs);
		if (nextInterval !== this.intervalMs || nextDuration !== this.durationMs) {
			this.intervalMs = nextInterval;
			this.durationMs = nextDuration;
			if (this.listeners.size > 0) {
				this.ensureRunning();
			}
		}
	}

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		if (!this.visBound && typeof document !== "undefined") {
			this.visBound = true;
			document.addEventListener("visibilitychange", this.handleVisibility);
		}
		if (this.listeners.size === 1) {
			this.ensureRunning();
		}
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				this.stopTimers();
				if (this.visBound && typeof document !== "undefined") {
					this.visBound = false;
					document.removeEventListener(
						"visibilitychange",
						this.handleVisibility,
					);
				}
			}
		};
	};

	getSnapshot = () => this.state;
}

const sharedTicker = new SharedTrafficTicker();
const STATIC_SLIDE_STATE: SlideTickerState = { slideIndex: 0, fading: false };
const noopSubscribe = () => () => {};

function useSharedTrafficSlide(
	active: boolean,
	intervalMs: number,
	durationMs: number,
): SlideTickerState {
	if (active) {
		sharedTicker.configure(intervalMs, durationMs);
	}
	return useSyncExternalStore(
		active && intervalMs > 0 ? sharedTicker.subscribe : noopSubscribe,
		active && intervalMs > 0
			? sharedTicker.getSnapshot
			: () => STATIC_SLIDE_STATE,
		() => STATIC_SLIDE_STATE,
	);
}

export const CardTrafficBar = memo(function CardTrafficBar({
	serverId,
}: {
	serverId: number;
}) {
	const { traffic_bar } = useThemeConfig();
	const refreshMs = Math.max(5000, traffic_bar.interval_ms || 60000);

	const { data: serviceData } = useQuery({
		queryKey: ["service"],
		queryFn: () => fetchService(),
		refetchInterval: refreshMs,
		refetchIntervalInBackground: false,
		staleTime: Math.min(refreshMs, 30000),
		retry: false,
		enabled: traffic_bar.enabled,
	});

	const serverStat = useMemo(
		() =>
			extractCycleTrafficMap(serviceData?.data?.cycle_transfer_stats).get(
				serverId,
			),
		[serviceData?.data?.cycle_transfer_stats, serverId],
	);

	const { slideIndex, fading } = useSharedTrafficSlide(
		Boolean(traffic_bar.enabled && serverStat),
		traffic_bar.toggle_interval_ms,
		traffic_bar.duration_ms || 500,
	);

	if (!traffic_bar.enabled || !serverStat) return null;

	const used = formatFileSizeParts(serverStat.transfer);
	const total = formatFileSizeParts(serverStat.max);
	const pctNum =
		serverStat.max > 0
			? Math.min(100, (serverStat.transfer / serverStat.max) * 100)
			: 0;
	const pctText =
		serverStat.max > 0
			? ((serverStat.transfer / serverStat.max) * 100).toFixed(2)
			: "0.00";
	const fromStr = formatShortDate(serverStat.from);
	const toStr = formatShortDate(serverStat.to);
	const remainDays = calculateRemainingDaysUntil(serverStat.to);
	const barColor = getTrafficGradientColor(pctNum);
	const halfDuration = Math.max(
		50,
		Math.floor((traffic_bar.duration_ms || 500) / 2),
	);

	const slides = [
		<span key="range">
			{fromStr}
			<span className="text-neutral-500 dark:text-neutral-400"> - </span>
			{toStr}
		</span>,
		<span key="pct" className="text-neutral-800 dark:text-neutral-200">
			使用占比: {pctText}%
		</span>,
		<span key="reset" className="text-neutral-800 dark:text-neutral-200">
			流量重置日: {toStr}
		</span>,
		<span key="days" className="text-sky-600 dark:text-sky-400">
			剩余 {remainDays} 天重置
		</span>,
	];

	return (
		<div className="w-full space-y-1.5" data-nz-traffic-bar>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-baseline gap-0.5 text-[10px]">
					<span className="font-medium text-neutral-800 dark:text-neutral-200">
						{used.value} {used.unit}
					</span>
					<span className="text-neutral-500 dark:text-neutral-400">
						{" / "}
						{total.value} {total.unit}
					</span>
				</div>
				<div
					className="text-[10px] font-medium text-neutral-600 dark:text-neutral-300 min-h-[15px]"
					style={{
						opacity: fading ? 0 : 1,
						transition: `opacity ${halfDuration}ms ease`,
					}}
				>
					{slides[slideIndex % slides.length]}
				</div>
			</div>
			<div className="relative h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
				<div
					className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
					style={{
						width: `${pctNum.toFixed(2)}%`,
						backgroundColor: barColor,
					}}
				/>
			</div>
		</div>
	);
});
