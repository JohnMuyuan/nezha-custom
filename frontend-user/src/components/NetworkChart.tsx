"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, Globe2, Radio, Sparkles, Wifi } from "lucide-react";
import * as React from "react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	XAxis,
	YAxis,
} from "recharts";
import ChartSkeleton from "@/components/loading/ChartSkeleton";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	detectMonitorMeta,
	getLatencyHealth,
	MonitorIdentityBadge,
	type MonitorMeta,
} from "@/features/network-monitor/monitor-icons";
import {
	buildMonitorSeries,
	type MonitorChartPoint,
} from "@/features/network-monitor/monitor-series";
import { useActiveIndicator } from "@/hooks/use-active-indicator";
import { useLoginUser } from "@/hooks/use-login-user";
import { fetchMonitor, type MonitorPeriod } from "@/lib/nezha-api";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { cn, formatTime } from "@/lib/utils";
import type { NezhaMonitor, ServerMonitorChart } from "@/types/nezha-api";
import NetworkChartLoading from "./NetworkChartLoading";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

const MIN_PERIOD_LOADING_MS = 500;
const EMPTY_MONITORS: readonly NezhaMonitor[] = [];

export function NetworkChart({
	server_id,
	show,
}: {
	server_id: number;
	show: boolean;
}) {
	const { t } = useTranslation();
	const [period, setPeriod] = React.useState<MonitorPeriod>("1d");
	const { isAuthenticated: isLogin } = useLoginUser();

	React.useEffect(() => {
		if (!isLogin && period !== "1d") {
			setPeriod("1d");
		}
	}, [isLogin, period]);

	const {
		data: monitorData,
		isPending,
		isError,
		isFetching,
		isPlaceholderData,
		refetch,
	} = useQuery({
		queryKey: ["monitor", server_id, period],
		queryFn: () => fetchMonitor(server_id, period),
		enabled: show,
		placeholderData: (previousData, previousQuery) =>
			previousQuery?.queryKey[1] === server_id
				? keepPreviousData(previousData)
				: undefined,
		retry: false,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchInterval: 10000,
	});

	const monitors = monitorData?.success
		? (monitorData.data ?? EMPTY_MONITORS)
		: EMPTY_MONITORS;
	const { chartData, formattedData, chartDataKey } = useMemo(
		() => buildMonitorSeries(monitors),
		[monitors],
	);
	const chartConfig = useMemo(
		() =>
			({
				avg_delay: { label: t("monitor.avgDelay") },
				...chartDataKey.reduce((config, key) => {
					config[key] = { label: key };
					return config;
				}, {} as ChartConfig),
			}) satisfies ChartConfig,
		[chartDataKey, t],
	);
	const hasError = isError || monitorData?.success === false;
	const hasCachedData = !!monitorData?.success;
	const retryButton = (
		<button
			type="button"
			disabled={isFetching}
			onClick={() => void refetch()}
			className="rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
		>
			{t("monitor.retry")}
		</button>
	);

	if (isPending) return <NetworkChartLoading />;

	if (hasError && !hasCachedData) {
		return (
			<div
				role="alert"
				className="flex min-h-62.5 flex-col items-center justify-center gap-3 text-sm"
			>
				<p className="text-destructive">{t("monitor.loadError")}</p>
				{retryButton}
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{hasError && (
				<div
					role="status"
					className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
				>
					<p>{t("monitor.staleData")}</p>
					{retryButton}
				</div>
			)}
			{monitors.length === 0 ? (
				<div
					role="status"
					className="flex min-h-62.5 items-center justify-center text-sm text-muted-foreground"
				>
					{t("monitor.noData")}
				</div>
			) : (
				<NetworkChartClient
					chartDataKey={chartDataKey}
					chartConfig={chartConfig}
					chartData={chartData}
					serverName={monitors[0].server_name}
					formattedData={formattedData}
					isPeriodLoading={isPlaceholderData}
					period={period}
					onPeriodChange={setPeriod}
					isLogin={isLogin}
				/>
			)}
		</div>
	);
}

export const NetworkChartClient = React.memo(function NetworkChart({
	chartDataKey,
	chartConfig,
	chartData,
	serverName,
	formattedData,
	isPeriodLoading,
	period,
	onPeriodChange,
	isLogin,
}: {
	chartDataKey: string[];
	chartConfig: ChartConfig;
	chartData: ServerMonitorChart;
	serverName: string;
	formattedData: MonitorChartPoint[];
	isPeriodLoading: boolean;
	period: MonitorPeriod;
	onPeriodChange: (period: MonitorPeriod) => void;
	isLogin: boolean;
}) {
	const { t } = useTranslation();
	const [showPeriodLoading, setShowPeriodLoading] = React.useState(false);
	const loadingStartedAtRef = React.useRef<number | null>(null);

	const TIME_RANGE_OPTIONS = useMemo<{ value: MonitorPeriod; label: string }[]>(
		() => [
			{ value: "1d", label: t("monitor.period1d") },
			{ value: "7d", label: t("monitor.period7d") },
			{ value: "30d", label: t("monitor.period30d") },
		],
		[t],
	);
	const timeRangeValues = useMemo(
		() => TIME_RANGE_OPTIONS.map((option) => option.value),
		[TIME_RANGE_OPTIONS],
	);
	const { containerRef, enableIndicatorAnimation, indicator, setItemRef } =
		useActiveIndicator(timeRangeValues, period);

	React.useEffect(() => {
		let timeoutId: number | undefined;

		if (isPeriodLoading) {
			loadingStartedAtRef.current = Date.now();
			setShowPeriodLoading(true);
			return;
		}

		const loadingStartedAt = loadingStartedAtRef.current;
		if (loadingStartedAt === null) {
			setShowPeriodLoading(false);
			return;
		}

		const elapsed = Date.now() - loadingStartedAt;
		const remaining = Math.max(0, MIN_PERIOD_LOADING_MS - elapsed);

		timeoutId = window.setTimeout(() => {
			setShowPeriodLoading(false);
			loadingStartedAtRef.current = null;
		}, remaining);

		return () => {
			if (timeoutId !== undefined) {
				window.clearTimeout(timeoutId);
			}
		};
	}, [isPeriodLoading]);

	const { backgroundImage: customBackgroundImage, forcePeakCutEnabled } =
		useRuntimeConfig();

	// Change from string to string array for multi-selection
	const [selectedCharts, setActiveCharts] = React.useState<string[]>([]);
	const activeCharts = useMemo(
		() =>
			selectedCharts.filter(
				(key) => chartDataKey.includes(key) && chartData[key],
			),
		[selectedCharts, chartDataKey, chartData],
	);
	const [isPeakEnabled, setIsPeakEnabled] = React.useState(forcePeakCutEnabled);

	// Function to clear all selected charts
	const clearAllSelections = useCallback(() => {
		setActiveCharts([]);
	}, []);

	// Updated to handle multiple selections
	const handleButtonClick = useCallback((chart: string) => {
		setActiveCharts((prev) => {
			// If chart is already selected, remove it
			if (prev.includes(chart)) {
				return prev.filter((c) => c !== chart);
			}
			// Otherwise, add it to selected charts
			return [...prev, chart];
		});
	}, []);

	const getColorByIndex = useCallback(
		(chart: string) => {
			const index = chartDataKey.indexOf(chart);
			return `hsl(var(--chart-${(index % 10) + 1}))`;
		},
		[chartDataKey],
	);

	const monitorMetaMap = useMemo(() => {
		const map: Record<string, MonitorMeta> = {};
		for (const key of chartDataKey) {
			map[key] = detectMonitorMeta(key);
		}
		return map;
	}, [chartDataKey]);

	const { domesticKeys, overseasKeys } = useMemo(() => {
		const domestic: string[] = [];
		const overseas: string[] = [];
		for (const key of chartDataKey) {
			const meta = monitorMetaMap[key];
			if (meta?.isDomesticCarrier) {
				domestic.push(key);
			} else if (meta?.countryCode && meta.countryCode !== "CN") {
				overseas.push(key);
			} else if (meta?.brand && meta.brand.category !== "cn-carrier") {
				overseas.push(key);
			}
		}
		return { domesticKeys: domestic, overseasKeys: overseas };
	}, [chartDataKey, monitorMetaMap]);

	const chartStats = useMemo(() => {
		const stats: {
			[key: string]: {
				minDelay: number | null;
				maxDelay: number | null;
				avgDelay: number | null;
				lastDelay: number | null;
				avgPacketLoss: number | null;
			};
		} = {};

		for (const key of chartDataKey) {
			const series = chartData[key] ?? [];
			const delays = series
				.map((sample) => sample.avg_delay)
				.filter((delay): delay is number => delay != null);
			const losses = series
				.map((sample) => sample.packet_loss)
				.filter((loss): loss is number => loss != null);
			const last = series[series.length - 1]?.avg_delay ?? null;
			stats[key] = {
				minDelay: delays.length ? Math.min(...delays) : null,
				maxDelay: delays.length ? Math.max(...delays) : null,
				avgDelay: delays.length
					? delays.reduce((sum, val) => sum + val, 0) / delays.length
					: null,
				lastDelay: last,
				avgPacketLoss: losses.length
					? losses.reduce((sum, val) => sum + val, 0) / losses.length
					: null,
			};
		}

		return stats;
	}, [chartDataKey, chartData]);

	const overviewMetrics = useMemo(() => {
		const latestDelays: number[] = [];
		const losses: number[] = [];
		for (const key of chartDataKey) {
			const st = chartStats[key];
			if (st?.lastDelay != null) latestDelays.push(st.lastDelay);
			if (st?.avgPacketLoss != null) losses.push(st.avgPacketLoss);
		}
		return {
			bestDelay: latestDelays.length ? Math.min(...latestDelays) : null,
			meanDelay: latestDelays.length
				? latestDelays.reduce((a, b) => a + b, 0) / latestDelays.length
				: null,
			meanLoss: losses.length
				? losses.reduce((a, b) => a + b, 0) / losses.length
				: null,
		};
	}, [chartDataKey, chartStats]);

	const chartButtons = useMemo(
		() =>
			chartDataKey.map((key) => {
				const stats = chartStats[key];
				const lastDelay = stats?.lastDelay ?? null;
				const avgPacketLoss = stats?.avgPacketLoss ?? null;
				const meta = monitorMetaMap[key] ?? detectMonitorMeta(key);
				const seriesColor = getColorByIndex(key);
				const health = getLatencyHealth(lastDelay);
				const isSelected = activeCharts.includes(key);
				const isDimmed = activeCharts.length > 0 && !isSelected;

				return (
					<button
						key={key}
						type="button"
						data-active={isSelected}
						aria-pressed={isSelected}
						className={cn(
							"group relative flex cursor-pointer flex-col justify-between gap-2.5 overflow-hidden rounded-xl border-2 px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow,opacity] duration-200",
							"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
							isSelected
								? "border-primary/75 bg-primary/[0.05] shadow-sm dark:bg-primary/[0.11] forced-colors:outline-2"
								: "border-border/55 bg-background/70 hover:border-border hover:bg-muted/40 dark:bg-card/60",
							isDimmed && "opacity-65 hover:opacity-100",
						)}
						onClick={() => handleButtonClick(key)}
					>
						{/* Top series-color accent strip */}
						<span
							aria-hidden="true"
							className={cn(
								"pointer-events-none absolute inset-x-0 top-0 h-[3px] transition-opacity duration-200",
								isSelected
									? "opacity-100"
									: "opacity-35 group-hover:opacity-80",
							)}
							style={{ backgroundColor: seriesColor }}
						/>

						{/* Top identity row: Icon + Monitor Name + IP/Route pills */}
						<div className="flex items-start gap-2.5">
							<MonitorIdentityBadge meta={meta} seriesColor={seriesColor} />
							<div className="min-w-0 flex-1">
								<div className="flex items-center justify-between gap-1.5">
									<div className="flex min-w-0 items-center gap-1.5">
										<span
											aria-hidden="true"
											className="h-2 w-2 shrink-0 rounded-full"
											style={{ backgroundColor: seriesColor }}
										/>
										<span className="truncate text-xs font-semibold text-foreground">
											{key}
										</span>
									</div>
									{isSelected && (
										<span
											aria-hidden="true"
											className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
										>
											<Check className="h-2.5 w-2.5 stroke-[3]" />
										</span>
									)}
								</div>

								<div className="mt-1 flex flex-wrap items-center gap-1">
									{meta.ipStack && (
										<span
											className={cn(
												"inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none",
												meta.ipStack === "IPv6"
													? "bg-violet-500/12 text-violet-700 dark:text-violet-300"
													: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
											)}
										>
											{meta.ipStack}
										</span>
									)}
									{meta.routeTag && (
										<span className="inline-flex items-center rounded bg-amber-500/12 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-amber-700 dark:text-amber-300">
											{meta.routeTag}
										</span>
									)}
									{!meta.ipStack && !meta.routeTag && meta.brand && (
										<span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
											{meta.brand.label}
										</span>
									)}
									{!meta.ipStack &&
										!meta.routeTag &&
										!meta.brand &&
										meta.countryCode && (
											<span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-muted-foreground">
												{meta.countryCode}
											</span>
										)}
								</div>
							</div>
						</div>

						{/* Middle latency KPI + non-color signal strength meter */}
						<div className="flex items-end justify-between gap-2 pt-0.5">
							<span
								className={cn(
									"text-lg font-bold leading-none tracking-tight tabular-nums sm:text-xl",
									lastDelay == null
										? "text-muted-foreground"
										: health.textClass,
								)}
							>
								{lastDelay == null ? "—" : `${lastDelay.toFixed(2)}ms`}
							</span>
							{lastDelay != null && (
								<div
									className="flex items-end gap-1"
									title={`链路质量：${health.label}`}
								>
									<span className="text-[10px] font-medium text-muted-foreground">
										{health.label}
									</span>
									<span
										aria-hidden="true"
										className="flex h-3.5 items-end gap-[2px]"
									>
										{[1, 2, 3, 4].map((bar) => (
											<span
												key={bar}
												className={cn(
													"w-[3px] rounded-full transition-colors",
													bar <= health.bars
														? health.barClass
														: "bg-muted-foreground/20",
												)}
												style={{ height: `${bar * 25}%` }}
											/>
										))}
									</span>
								</div>
							)}
						</div>

						{/* Bottom min / max / avg / packet-loss telemetry strip */}
						<div className="flex items-center justify-between gap-2 border-t border-border/45 pt-2 text-[11px] tabular-nums">
							<div className="flex items-center gap-2">
								<span className="font-medium text-emerald-600 dark:text-emerald-400">
									↓{stats?.minDelay?.toFixed(0) ?? "—"}
								</span>
								<span className="font-medium text-rose-600 dark:text-rose-400">
									↑{stats?.maxDelay?.toFixed(0) ?? "—"}
								</span>
								{stats?.avgDelay != null && (
									<span className="hidden text-muted-foreground sm:inline">
										≈{stats.avgDelay.toFixed(0)}
									</span>
								)}
							</div>
							{avgPacketLoss !== null && (
								<span
									className={cn(
										"inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
										avgPacketLoss === 0
											? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
											: avgPacketLoss < 2
												? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
												: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
									)}
								>
									{avgPacketLoss.toFixed(2)}%
								</span>
							)}
						</div>
					</button>
				);
			}),
		[
			chartDataKey,
			activeCharts,
			chartStats,
			monitorMetaMap,
			getColorByIndex,
			handleButtonClick,
		],
	);

	const chartElements = useMemo(() => {
		const elements = [];

		// If exactly one chart is selected, show delay line and packet loss area
		if (activeCharts.length === 1) {
			const chart = activeCharts[0];
			elements.push(
				<Area
					key="packet-loss-area"
					isAnimationActive={false}
					dataKey="packet_loss"
					stroke="none"
					fill="hsl(45, 100%, 60%)"
					fillOpacity={0.28}
					yAxisId="packet-loss"
				/>,
				<Line
					key="delay-line"
					isAnimationActive={false}
					strokeWidth={2}
					type="linear"
					dot={false}
					activeDot={{ r: 3.5, strokeWidth: 0 }}
					dataKey="avg_delay"
					stroke={getColorByIndex(chart)}
					yAxisId="delay"
					connectNulls={true}
				/>,
			);
		} else if (activeCharts.length > 1) {
			// Multiple charts selected - show only delay lines for selected monitors
			elements.push(
				...activeCharts.map((chart) => (
					<Line
						key={chart}
						isAnimationActive={false}
						strokeWidth={1.75}
						type="linear"
						dot={false}
						activeDot={{ r: 3, strokeWidth: 0 }}
						dataKey={chart}
						stroke={getColorByIndex(chart)}
						name={chart}
						connectNulls={true}
						yAxisId="delay"
					/>
				)),
			);
		} else {
			// No selection - show all charts (default view)
			elements.push(
				...chartDataKey.map((key) => (
					<Line
						key={key}
						isAnimationActive={false}
						strokeWidth={1.5}
						type="linear"
						dot={false}
						activeDot={{ r: 3, strokeWidth: 0 }}
						dataKey={key}
						stroke={getColorByIndex(key)}
						connectNulls={true}
						yAxisId="delay"
					/>
				)),
			);
		}

		return elements;
	}, [activeCharts, chartDataKey, getColorByIndex]);

	const processedData = useMemo(() => {
		// Special handling for single chart selection
		let baseData = formattedData;
		if (activeCharts.length === 1) {
			const selectedChart = activeCharts[0];
			baseData = chartData[selectedChart].map((item) => ({
				created_at: item.created_at,
				avg_delay: item.avg_delay,
				packet_loss: item.packet_loss,
			}));
		}

		if (!isPeakEnabled) {
			return baseData;
		}

		// For peak cutting, use the base data
		const data = baseData;

		const windowSize = 11; // 增加窗口大小以获取更好的统计效果
		const alpha = 0.3; // EWMA平滑因子

		// 辅助函数：计算中位数
		const getMedian = (arr: number[]) => {
			const sorted = [...arr].sort((a, b) => a - b);
			const mid = Math.floor(sorted.length / 2);
			return sorted.length % 2
				? sorted[mid]
				: (sorted[mid - 1] + sorted[mid]) / 2;
		};

		// 辅助函数：异常值处理
		const processValues = (values: number[]) => {
			if (values.length === 0) return null;

			const median = getMedian(values);
			const deviations = values.map((v) => Math.abs(v - median));
			const medianDeviation = getMedian(deviations) * 1.4826; // MAD估计器

			// 使用中位数绝对偏差(MAD)进行异常值检测
			const validValues = values.filter(
				(v) =>
					Math.abs(v - median) <= 3 * medianDeviation && // 更严格的异常值判定
					v <= median * 3, // 限制最大值不超过中位数的3倍
			);

			if (validValues.length === 0) return median; // 如果没有有效值，返回中位数

			// 计算EWMA
			let ewma = validValues[0];
			for (let i = 1; i < validValues.length; i++) {
				ewma = alpha * validValues[i] + (1 - alpha) * ewma;
			}

			return ewma;
		};

		// 初始化EWMA历史值
		const ewmaHistory: { [key: string]: number } = {};

		return data.map((point, index) => {
			if (index < windowSize - 1) return point;

			const window = data.slice(index - windowSize + 1, index + 1);
			const smoothed = { ...point } as MonitorChartPoint;

			// Special handling for single chart selection
			if (activeCharts.length === 1) {
				// Process avg_delay for single chart
				const values = window
					.map((w) => w.avg_delay)
					.filter((value): value is number => value != null);

				if (values.length > 0) {
					const processed = processValues(values);
					if (processed !== null) {
						if (ewmaHistory.avg_delay === undefined) {
							ewmaHistory.avg_delay = processed;
						} else {
							ewmaHistory.avg_delay =
								alpha * processed + (1 - alpha) * ewmaHistory.avg_delay;
						}
						smoothed.avg_delay = ewmaHistory.avg_delay;
					}
				}
			} else {
				// Process all chart keys or just the selected ones
				const keysToProcess =
					activeCharts.length > 0 ? activeCharts : chartDataKey;

				keysToProcess.forEach((key) => {
					const values = window
						.map((w) => w[key])
						.filter((value): value is number => value != null);

					if (values.length > 0) {
						const processed = processValues(values);
						if (processed !== null) {
							// Apply EWMA smoothing
							if (ewmaHistory[key] === undefined) {
								ewmaHistory[key] = processed;
							} else {
								ewmaHistory[key] =
									alpha * processed + (1 - alpha) * ewmaHistory[key];
							}
							smoothed[key] = ewmaHistory[key];
						}
					}
				});
			}

			return smoothed;
		});
	}, [isPeakEnabled, activeCharts, formattedData, chartData, chartDataKey]);

	const isDomesticPresetActive =
		domesticKeys.length > 0 &&
		activeCharts.length === domesticKeys.length &&
		domesticKeys.every((k) => activeCharts.includes(k));
	const isOverseasPresetActive =
		overseasKeys.length > 0 &&
		activeCharts.length === overseasKeys.length &&
		overseasKeys.every((k) => activeCharts.includes(k));
	const hasGroupPresets = domesticKeys.length > 0 && overseasKeys.length > 0;

	return (
		<div className="flex flex-col gap-3.5">
			<div className="flex flex-wrap items-center justify-between gap-2.5 sm:-mt-4 -mt-2">
				<div className="flex flex-wrap items-center gap-3">
					<TooltipProvider delayDuration={120}>
						<div
							ref={containerRef}
							className="relative flex items-center gap-1 rounded-full border border-border/60 bg-muted p-0.5 dark:border-border dark:bg-muted/40"
						>
							{indicator && (
								<div
									className="active-indicator-fade-in absolute left-0 top-0 z-10 rounded-full bg-white ring-1 ring-border/60 dark:bg-background dark:ring-border/40"
									style={{
										height: indicator.height,
										transform: `translate(${indicator.x}px, ${indicator.y}px)`,
										transition: indicator.shouldAnimate
											? "transform 0.5s var(--timing), width 0.5s var(--timing), height 0.5s var(--timing)"
											: "none",
										width: indicator.width,
									}}
								/>
							)}
							{TIME_RANGE_OPTIONS.map((option, index) => {
								const isLocked = !isLogin && option.value !== "1d";
								const optionItem = (
									<div
										ref={setItemRef(index)}
										onClick={() => {
											if (!isLocked) {
												if (period !== option.value) {
													enableIndicatorAnimation();
												}
												onPeriodChange(option.value);
											}
										}}
										className={cn(
											"relative cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-300",
											period === option.value
												? "text-foreground"
												: "text-muted-foreground hover:text-foreground",
											isLocked && "cursor-not-allowed opacity-40 grayscale",
										)}
									>
										<span className="relative z-20">{option.label}</span>
									</div>
								);

								if (isLocked) {
									return (
										<Tooltip key={option.value}>
											<TooltipTrigger asChild>{optionItem}</TooltipTrigger>
											<TooltipContent>
												{t("monitor.loginRequired", "Please login to view")}
											</TooltipContent>
										</Tooltip>
									);
								}

								return <div key={option.value}>{optionItem}</div>;
							})}
						</div>
					</TooltipProvider>
					<div className="flex items-center space-x-2">
						<Switch
							id="Peak"
							checked={isPeakEnabled}
							onCheckedChange={setIsPeakEnabled}
						/>
						<Label className="text-xs" htmlFor="Peak">
							{t("monitor.peakCut")}
						</Label>
					</div>
				</div>

				{hasGroupPresets && (
					<div className="flex flex-wrap items-center gap-1.5">
						<button
							type="button"
							onClick={clearAllSelections}
							className={cn(
								"inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
								activeCharts.length === 0
									? "border-primary/50 bg-primary/10 text-primary"
									: "border-border/60 bg-card/70 text-muted-foreground hover:text-foreground",
							)}
						>
							<Sparkles className="h-3 w-3" aria-hidden="true" />
							全部 ({chartDataKey.length})
						</button>
						<button
							type="button"
							onClick={() =>
								setActiveCharts(isDomesticPresetActive ? [] : domesticKeys)
							}
							className={cn(
								"inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
								isDomesticPresetActive
									? "border-blue-500/50 bg-blue-500/12 text-blue-700 dark:text-blue-300"
									: "border-border/60 bg-card/70 text-muted-foreground hover:text-foreground",
							)}
						>
							<Radio className="h-3 w-3" aria-hidden="true" />
							国内三网 ({domesticKeys.length})
						</button>
						<button
							type="button"
							onClick={() =>
								setActiveCharts(isOverseasPresetActive ? [] : overseasKeys)
							}
							className={cn(
								"inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
								isOverseasPresetActive
									? "border-emerald-500/50 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
									: "border-border/60 bg-card/70 text-muted-foreground hover:text-foreground",
							)}
						>
							<Globe2 className="h-3 w-3" aria-hidden="true" />
							海外节点 ({overseasKeys.length})
						</button>
					</div>
				)}
			</div>

			<Card
				className={cn(
					"overflow-hidden border-border/75 shadow-sm backdrop-blur-sm",
					customBackgroundImage ? "bg-card/75" : "bg-card/95",
				)}
			>
				<CardHeader className="space-y-4 border-b border-border/60 bg-muted/20 p-4 sm:p-5">
					{/* Top Telemetry Summary Bar */}
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex items-center gap-2.5">
							<span
								aria-hidden="true"
								className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
							>
								<Wifi className="h-4 w-4" />
							</span>
							<div>
								<CardTitle className="flex items-center gap-2 text-sm font-bold sm:text-base">
									<span>{serverName}</span>
								</CardTitle>
								<CardDescription className="text-xs">
									{chartDataKey.length} {t("monitor.monitorCount")}
								</CardDescription>
							</div>
						</div>

						{overviewMetrics.bestDelay != null && (
							<div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
								<div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1">
									<span className="text-[11px] text-muted-foreground">
										最低延迟
									</span>
									<span className="font-bold text-emerald-600 dark:text-emerald-400">
										{overviewMetrics.bestDelay.toFixed(1)}ms
									</span>
								</div>
								{overviewMetrics.meanDelay != null && (
									<div className="hidden items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1 sm:inline-flex">
										<span className="text-[11px] text-muted-foreground">
											平均延迟
										</span>
										<span className="font-bold text-foreground">
											{overviewMetrics.meanDelay.toFixed(1)}ms
										</span>
									</div>
								)}
								{overviewMetrics.meanLoss != null && (
									<div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1">
										<span className="text-[11px] text-muted-foreground">
											平均丢包
										</span>
										<span
											className={cn(
												"font-bold",
												overviewMetrics.meanLoss === 0
													? "text-emerald-600 dark:text-emerald-400"
													: overviewMetrics.meanLoss < 2
														? "text-amber-600 dark:text-amber-400"
														: "text-rose-600 dark:text-rose-400",
											)}
										>
											{overviewMetrics.meanLoss.toFixed(2)}%
										</span>
									</div>
								)}
							</div>
						)}
					</div>

					{/* Responsive Carrier & Overseas Monitor Cards Grid */}
					<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
						{chartButtons}
					</div>
				</CardHeader>

				<CardContent className="py-4 pl-0 pr-2 sm:pb-6 sm:pl-2 sm:pr-6 sm:pt-6">
					<div className="relative">
						{formattedData.length === 0 && (
							<p
								role="status"
								className="px-6 pb-3 text-sm text-muted-foreground"
							>
								{t("monitor.noData")}
							</p>
						)}
						{activeCharts.length > 0 && (
							<button
								type="button"
								className="absolute -top-2 right-1 z-10 rounded-full border border-border/70 bg-background/90 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur-xs transition-colors hover:border-border hover:text-foreground"
								onClick={clearAllSelections}
							>
								{t("monitor.clearSelections", "Clear")} ({activeCharts.length})
							</button>
						)}
						<ChartContainer
							config={chartConfig}
							className={cn(
								"aspect-auto h-62.5 w-full transition-opacity",
								showPeriodLoading && "opacity-60",
							)}
						>
							<ComposedChart
								accessibilityLayer
								data={processedData}
								margin={{ left: 12, right: 12 }}
							>
								<CartesianGrid
									vertical={false}
									strokeDasharray="3 3"
									strokeOpacity={0.45}
								/>
								<XAxis
									dataKey="created_at"
									tickLine={true}
									tickSize={3}
									axisLine={false}
									tickMargin={8}
									minTickGap={80}
									ticks={processedData
										.filter((item, index, array) => {
											if (array.length < 6) {
												return index === 0 || index === array.length - 1;
											}

											// 计算数据的总时间跨度（毫秒）
											const timeSpan =
												array[array.length - 1].created_at -
												array[0].created_at;
											const hours = timeSpan / (1000 * 60 * 60);

											// 根据时间跨度调整显示间隔
											if (hours <= 12) {
												// 12小时内，每60分钟显示一个刻度
												return (
													index === 0 ||
													index === array.length - 1 ||
													new Date(item.created_at).getMinutes() % 60 === 0
												);
											}
											// 超过12小时，每2小时显示一个刻度
											const date = new Date(item.created_at);
											return (
												date.getMinutes() === 0 && date.getHours() % 2 === 0
											);
										})
										.map((item) => item.created_at)}
									tickFormatter={(value) => {
										const date = new Date(value);
										const minutes = date.getMinutes();
										return minutes === 0
											? `${date.getHours()}:00`
											: `${date.getHours()}:${minutes}`;
									}}
								/>
								<YAxis
									yAxisId="delay"
									tickLine={false}
									axisLine={false}
									tickMargin={15}
									minTickGap={20}
									tickFormatter={(value) => `${value}ms`}
								/>
								{activeCharts.length === 1 && (
									<YAxis
										yAxisId="packet-loss"
										orientation="right"
										tickLine={false}
										axisLine={false}
										tickMargin={15}
										minTickGap={20}
										tickFormatter={(value) => `${value}%`}
									/>
								)}
								<ChartTooltip
									isAnimationActive={false}
									content={
										<ChartTooltipContent
											indicator={"line"}
											labelKey="created_at"
											labelFormatter={(_, payload) => {
												return formatTime(payload[0].payload.created_at);
											}}
											formatter={(value, name) => {
												let formattedValue: string;
												let label: string;
												let seriesKey: string | null = null;

												if (name === "packet_loss") {
													formattedValue = `${Number(value).toFixed(2)}%`;
													label = t("monitor.packetLoss", "Packet Loss");
												} else if (name === "avg_delay") {
													formattedValue = `${Number(value).toFixed(2)}ms`;
													label = t("monitor.avgDelay", "Avg Delay");
													seriesKey = activeCharts[0] ?? null;
												} else {
													// For monitor names (in multi-chart view) - delay data
													formattedValue = `${Number(value).toFixed(2)}ms`;
													label = name as string;
													seriesKey = name as string;
												}

												const tooltipMeta = seriesKey
													? (monitorMetaMap[seriesKey] ??
														detectMonitorMeta(seriesKey))
													: null;

												return (
													<div className="flex flex-1 items-center justify-between gap-2 leading-none">
														<span className="flex items-center gap-1.5 text-muted-foreground">
															{tooltipMeta && seriesKey && (
																<MonitorIdentityBadge
																	meta={tooltipMeta}
																	seriesColor={getColorByIndex(seriesKey)}
																	size="sm"
																/>
															)}
															<span>{label}</span>
														</span>
														<span className="ml-2 font-medium text-foreground tabular-nums">
															{formattedValue}
														</span>
													</div>
												);
											}}
										/>
									}
								/>
								{activeCharts.length !== 1 && (
									<ChartLegend content={<ChartLegendContent />} />
								)}
								{chartElements}
							</ComposedChart>
						</ChartContainer>
						{showPeriodLoading && (
							<div
								role="status"
								aria-label={t("serviceTracker.loading")}
								aria-busy="true"
								className="pointer-events-none absolute inset-0 z-20 rounded-md bg-card/90"
							>
								<ChartSkeleton />
							</div>
						)}
					</div>
				</CardContent>
			</Card>
		</div>
	);
});
