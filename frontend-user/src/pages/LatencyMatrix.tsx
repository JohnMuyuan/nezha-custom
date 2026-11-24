import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertTriangle,
	ArrowLeft,
	ExternalLink,
	Flame,
	Gauge,
	Lock,
	Pin,
	RefreshCw,
	Search,
	ShieldCheck,
	Trophy,
	Waves,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import GroupSwitch from "@/components/GroupSwitch";
import ServerFlag from "@/components/ServerFlag";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { CellSparkline } from "@/features/latency-matrix/CellSparkline";
import { LatencyCompareChart } from "@/features/latency-matrix/LatencyCompareChart";
import "@/features/latency-matrix/latency-matrix.css";
import {
	computeFleetHighlights,
	formatMs,
	getCellHeatStyle,
	getStabilityMeta,
	type LatencySortKey,
	type SortDirection,
	sortLatencyServers,
} from "@/features/latency-matrix/stability";
import {
	detectMonitorMeta,
	MonitorIdentityBadge,
} from "@/features/network-monitor/monitor-icons";
import {
	selectGroupServerIds,
	selectGroupTabs,
} from "@/features/servers/selectors";
import { useLoginUser } from "@/hooks/use-login-user";
import { fetchLatencyOverview, fetchServerGroup } from "@/lib/nezha-api";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { cn } from "@/lib/utils";
import type {
	LatencyCellStats,
	LatencyOverviewMonitor,
	LatencyOverviewServer,
	LatencyPeriod,
} from "@/types/nezha-api";

const SERIES_COLORS = [
	"hsl(var(--chart-1))",
	"hsl(var(--chart-2))",
	"hsl(var(--chart-3))",
	"hsl(var(--chart-4))",
	"hsl(var(--chart-5))",
	"hsl(var(--chart-6))",
	"hsl(var(--chart-7))",
	"hsl(var(--chart-8))",
	"hsl(var(--chart-9))",
	"hsl(var(--chart-10))",
];

type MonitorScope = "all" | "domestic" | "overseas";

function SortArrowsIcon() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 12 16"
			className="latency-sort-icon"
			fill="currentColor"
		>
			<path className="latency-sort-up" d="M6 2L10 6.5H2L6 2Z" />
			<path className="latency-sort-down" d="M6 14L2 9.5H10L6 14Z" />
		</svg>
	);
}

function LatencyCellDetailTooltip({
	serverName,
	monitorName,
	cell,
}: {
	serverName: string;
	monitorName: string;
	cell: LatencyCellStats;
}) {
	const stab = getStabilityMeta(cell.stability_score, true);
	return (
		<div className="min-w-48 space-y-1.5 text-xs tabular-nums">
			<div className="border-b border-border/60 pb-1">
				<div className="font-semibold text-foreground">{serverName}</div>
				<div className="text-[11px] text-muted-foreground">{monitorName}</div>
			</div>
			<div className="grid grid-cols-2 gap-x-4 gap-y-1">
				<span className="text-muted-foreground">平均延迟</span>
				<span className="text-right font-semibold">{formatMs(cell.avg_ms)}</span>
				<span className="text-muted-foreground">最新延迟</span>
				<span className="text-right">{formatMs(cell.latest_ms)}</span>
				<span className="text-muted-foreground">最小 / 最大</span>
				<span className="text-right">
					{formatMs(cell.min_ms, 0)} / {formatMs(cell.max_ms, 0)}
				</span>
				<span className="text-muted-foreground">P95 延迟</span>
				<span className="text-right">{formatMs(cell.p95_ms)}</span>
				<span className="text-muted-foreground">平均抖动</span>
				<span className="text-right">±{formatMs(cell.jitter_ms)}</span>
				<span className="text-muted-foreground">丢包率</span>
				<span
					className={cn(
						"text-right font-semibold",
						cell.loss_percent > 0 && "text-rose-600 dark:text-rose-400",
					)}
				>
					{cell.loss_percent.toFixed(2)}%
				</span>
				<span className="text-muted-foreground">稳定性评分</span>
				<span className={cn("text-right font-semibold", stab.textClass)}>
					{stab.symbol} {cell.stability_score.toFixed(1)} ({stab.label})
				</span>
				<span className="text-muted-foreground">样本数</span>
				<span className="text-right text-muted-foreground">
					{cell.sample_count}
				</span>
			</div>
		</div>
	);
}

export default function LatencyMatrix() {
	const { t } = useTranslation();
	const captionId = useId();
	const searchId = useId();
	const { isAuthenticated: isLogin } = useLoginUser();
	const { backgroundImage: customBackgroundImage } = useRuntimeConfig();

	const [period, setPeriod] = useState<LatencyPeriod>("1h");
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [currentGroup, setCurrentGroup] = useState("All");
	const [searchQuery, setSearchQuery] = useState("");
	const [monitorScope, setMonitorScope] = useState<MonitorScope>("all");
	const [sortKey, setSortKey] = useState<LatencySortKey>("avg");
	const [sortDir, setSortDir] = useState<SortDirection>("ascending");
	const [sortAnnouncement, setSortAnnouncement] = useState("");
	const [selectedMonitorId, setSelectedMonitorId] = useState<number | null>(
		null,
	);
	const [pinnedServerIds, setPinnedServerIds] = useState<number[] | null>(null);

	useEffect(() => {
		if (!isLogin && period === "7d") {
			setPeriod("1d");
		}
	}, [isLogin, period]);

	const {
		data: overviewResp,
		isPending,
		isFetching,
		isError,
		refetch,
	} = useQuery({
		queryKey: ["latency-overview", period],
		queryFn: () => fetchLatencyOverview(period),
		placeholderData: keepPreviousData,
		refetchInterval: autoRefresh ? 30_000 : false,
		refetchOnWindowFocus: true,
		retry: false,
	});

	const { data: groupData } = useQuery({
		queryKey: ["server-group"],
		queryFn: () => fetchServerGroup(),
		retry: false,
	});

	const groupTabs = useMemo(
		() => selectGroupTabs(groupData?.data),
		[groupData?.data],
	);
	const groupServerIdSets = useMemo(
		() => selectGroupServerIds(groupData?.data),
		[groupData?.data],
	);

	const monitors = useMemo<LatencyOverviewMonitor[]>(
		() => (overviewResp?.success ? (overviewResp.data?.monitors ?? []) : []),
		[overviewResp],
	);
	const allServers = useMemo<LatencyOverviewServer[]>(
		() => (overviewResp?.success ? (overviewResp.data?.servers ?? []) : []),
		[overviewResp],
	);

	const monitorMetaById = useMemo(() => {
		const map = new Map<number, ReturnType<typeof detectMonitorMeta>>();
		for (const mon of monitors) {
			map.set(mon.id, detectMonitorMeta(mon.name));
		}
		return map;
	}, [monitors]);

	const { hasDomestic, hasOverseas } = useMemo(() => {
		let dom = false;
		let ov = false;
		for (const mon of monitors) {
			const meta = monitorMetaById.get(mon.id);
			if (meta?.isDomesticCarrier) dom = true;
			else ov = true;
		}
		return { hasDomestic: dom, hasOverseas: ov };
	}, [monitors, monitorMetaById]);

	const visibleMonitors = useMemo(() => {
		if (monitorScope === "all") return monitors;
		return monitors.filter((mon) => {
			const meta = monitorMetaById.get(mon.id);
			if (monitorScope === "domestic") return !!meta?.isDomesticCarrier;
			return !meta?.isDomesticCarrier;
		});
	}, [monitors, monitorScope, monitorMetaById]);

	useEffect(() => {
		if (visibleMonitors.length === 0) return;
		if (
			selectedMonitorId == null ||
			!visibleMonitors.some((m) => m.id === selectedMonitorId)
		) {
			setSelectedMonitorId(visibleMonitors[0].id);
		}
	}, [visibleMonitors, selectedMonitorId]);

	const filteredServers = useMemo(() => {
		const groupSet =
			currentGroup !== "All" ? groupServerIdSets.get(currentGroup) : undefined;
		const q = searchQuery.trim().toLowerCase();
		return allServers.filter((srv) => {
			if (groupSet && !groupSet.has(srv.id)) return false;
			if (q && !srv.name.toLowerCase().includes(q)) return false;
			return true;
		});
	}, [allServers, currentGroup, groupServerIdSets, searchQuery]);

	// Recompute per-server rollups scoped to visibleMonitors when scope filter is active
	const scopedServers = useMemo<LatencyOverviewServer[]>(() => {
		if (monitorScope === "all") return filteredServers;
		const visibleIds = new Set(visibleMonitors.map((m) => String(m.id)));
		return filteredServers.map((srv) => {
			let avgSum = 0;
			let avgCnt = 0;
			let latestSum = 0;
			let latestCnt = 0;
			let p95Sum = 0;
			let p95Cnt = 0;
			let jitterSum = 0;
			let jitterCnt = 0;
			let lossSum = 0;
			let stabSum = 0;
			let cellCnt = 0;

			for (const [monId, cell] of Object.entries(srv.cells ?? {})) {
				if (!visibleIds.has(monId)) continue;
				cellCnt++;
				lossSum += cell.loss_percent;
				stabSum += cell.stability_score;
				if (cell.avg_ms != null) {
					avgSum += cell.avg_ms;
					avgCnt++;
				}
				if (cell.latest_ms != null) {
					latestSum += cell.latest_ms;
					latestCnt++;
				}
				if (cell.p95_ms != null) {
					p95Sum += cell.p95_ms;
					p95Cnt++;
				}
				if (cell.jitter_ms != null) {
					jitterSum += cell.jitter_ms;
					jitterCnt++;
				}
			}

			return {
				...srv,
				monitor_count: cellCnt,
				avg_ms: avgCnt > 0 ? Number((avgSum / avgCnt).toFixed(2)) : null,
				latest_ms:
					latestCnt > 0 ? Number((latestSum / latestCnt).toFixed(2)) : null,
				p95_ms: p95Cnt > 0 ? Number((p95Sum / p95Cnt).toFixed(2)) : null,
				jitter_ms:
					jitterCnt > 0 ? Number((jitterSum / jitterCnt).toFixed(2)) : null,
				loss_percent: cellCnt > 0 ? Number((lossSum / cellCnt).toFixed(2)) : 0,
				stability_score:
					cellCnt > 0 ? Number((stabSum / cellCnt).toFixed(1)) : null,
			};
		});
	}, [filteredServers, monitorScope, visibleMonitors]);

	const sortedServers = useMemo(
		() => sortLatencyServers(scopedServers, sortKey, sortDir),
		[scopedServers, sortKey, sortDir],
	);

	const highlights = useMemo(
		() => computeFleetHighlights(scopedServers),
		[scopedServers],
	);

	const handleHeaderSort = useCallback(
		(key: LatencySortKey, label: string, defaultDir: SortDirection = "ascending") => {
			let nextDir: SortDirection = defaultDir;
			if (sortKey === key) {
				nextDir = sortDir === "ascending" ? "descending" : "ascending";
			}
			setSortKey(key);
			setSortDir(nextDir);
			const dirLabel = nextDir === "ascending" ? "升序" : "降序";
			setSortAnnouncement(
				`已按 ${label} ${dirLabel}排列，共 ${scopedServers.length} 台服务器`,
			);
		},
		[sortKey, sortDir, scopedServers.length],
	);

	const applyPresetSort = useCallback(
		(key: LatencySortKey, dir: SortDirection, label: string) => {
			setSortKey(key);
			setSortDir(dir);
			setSortAnnouncement(
				`已切换为「${label}」排序，共 ${scopedServers.length} 台服务器`,
			);
		},
		[scopedServers.length],
	);

	const handleTogglePinServer = useCallback(
		(serverId: number) => {
			setPinnedServerIds((prev) => {
				if (prev === null) {
					return [serverId];
				}
				if (prev.includes(serverId)) {
					return prev.filter((id) => id !== serverId);
				}
				return [...prev, serverId];
			});
		},
		[],
	);

	const periodOptions: { value: LatencyPeriod; label: string; loginOnly?: boolean }[] =
		[
			{ value: "1h", label: t("latencyMatrix.period1h", "1 小时") },
			{ value: "6h", label: t("latencyMatrix.period6h", "6 小时") },
			{ value: "1d", label: t("latencyMatrix.period1d", "24 小时") },
			{
				value: "7d",
				label: t("latencyMatrix.period7d", "7 天"),
				loginOnly: true,
			},
		];

	const generatedAtText = useMemo(() => {
		const ts = overviewResp?.data?.generated_at;
		if (!ts) return "";
		const d = new Date(ts);
		return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
	}, [overviewResp?.data?.generated_at]);

	const hasError = isError || overviewResp?.success === false;
	const hasCachedData = !!overviewResp?.success;

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
			{/* Top header & controls */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<Link
						to="/"
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-2xs transition-colors hover:bg-muted",
							customBackgroundImage && "bg-card/80 backdrop-blur-md",
						)}
					>
						<ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
						<span>{t("latencyMatrix.backHome", "返回首页")}</span>
					</Link>
					<div>
						<h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
							<Activity className="h-5 w-5 text-primary" aria-hidden="true" />
							{t("latencyMatrix.title", "全节点延迟与稳定性总览")}
						</h1>
						<p className="text-xs text-muted-foreground">
							{t(
								"latencyMatrix.subtitle",
								"同屏横向对比所有服务器的延迟、抖动与丢包率，快速定位最快与最不稳定节点",
							)}
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{/* Period selector */}
					<TooltipProvider delayDuration={120}>
						<fieldset
							aria-label={t("latencyMatrix.periodLabel", "统计时间窗口")}
							className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-muted/70 p-0.5"
						>
							{periodOptions.map((opt) => {
								const locked = !!opt.loginOnly && !isLogin;
								const active = period === opt.value;
								const btn = (
									<button
										key={opt.value}
										type="button"
										disabled={locked}
										aria-pressed={active}
										onClick={() => {
											if (!locked) setPeriod(opt.value);
										}}
										className={cn(
											"inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
											active
												? "bg-card text-foreground shadow-2xs"
												: "text-muted-foreground hover:text-foreground",
											locked && "cursor-not-allowed opacity-45",
										)}
									>
										{locked && <Lock className="h-3 w-3" aria-hidden="true" />}
										<span>{opt.label}</span>
									</button>
								);
								if (!locked) return btn;
								return (
									<Tooltip key={opt.value}>
										<TooltipTrigger asChild>
											<span>{btn}</span>
										</TooltipTrigger>
										<TooltipContent>
											{t("monitor.loginRequired", "请登录后查看")}
										</TooltipContent>
									</Tooltip>
								);
							})}
						</fieldset>
					</TooltipProvider>

					<button
						type="button"
						aria-pressed={autoRefresh}
						onClick={() => setAutoRefresh((v) => !v)}
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
							autoRefresh
								? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
								: "border-border bg-card text-muted-foreground hover:text-foreground",
						)}
					>
						<span
							aria-hidden="true"
							className={cn(
								"h-1.5 w-1.5 rounded-full",
								autoRefresh ? "bg-emerald-500" : "bg-muted-foreground/50",
							)}
						/>
						<span>
							{autoRefresh
								? t("latencyMatrix.autoRefreshOn", "自动刷新 30s")
								: t("latencyMatrix.autoRefreshOff", "已暂停刷新")}
						</span>
					</button>

					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={isFetching}
						onClick={() => void refetch()}
						className="h-8 rounded-full px-3 text-xs"
					>
						<RefreshCw
							className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")}
							aria-hidden="true"
						/>
						<span>{t("latencyMatrix.refresh", "刷新")}</span>
						{generatedAtText && (
							<span className="ml-1.5 hidden font-mono text-[11px] text-muted-foreground sm:inline">
								{generatedAtText}
							</span>
						)}
					</Button>
				</div>
			</div>

			{/* Error banner */}
			{hasError && !hasCachedData && (
				<div
					role="alert"
					className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-8 text-sm"
				>
					<p className="font-medium text-rose-700 dark:text-rose-300">
						{overviewResp?.error ||
							t("latencyMatrix.loadError", "加载全节点延迟数据失败")}
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void refetch()}
					>
						{t("monitor.retry", "重试")}
					</Button>
				</div>
			)}

			{isPending && !hasCachedData ? (
				<div className="space-y-4" aria-busy="true">
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{[1, 2, 3, 4].map((k) => (
							<Skeleton key={k} className="h-24 rounded-xl" />
						))}
					</div>
					<Skeleton className="h-96 rounded-xl" />
				</div>
			) : (
				<>
					{/* 4-Card Instant Insight KPI Strip */}
					<section
						aria-label={t("latencyMatrix.highlightsLabel", "节点延迟与稳定性摘要")}
						className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
					>
						{/* Fastest Server */}
						<Card
							className={cn(
								"border-emerald-500/30 shadow-2xs",
								customBackgroundImage && "bg-card/85 backdrop-blur-md",
							)}
						>
							<CardContent className="flex flex-col justify-between gap-2 p-4">
								<div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
									<span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
										<Trophy className="h-3.5 w-3.5" aria-hidden="true" />
										{t("latencyMatrix.fastestServer", "延迟最低节点")}
									</span>
									<span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
										AVG
									</span>
								</div>
								{highlights.fastest ? (
									<>
										<Link
											to={`/server/${highlights.fastest.id}`}
											className="flex items-center gap-1.5 truncate text-sm font-bold text-foreground hover:underline"
										>
											<ServerFlag country_code={highlights.fastest.country_code} />
											<span className="truncate">{highlights.fastest.name}</span>
										</Link>
										<div className="flex items-baseline justify-between gap-2 tabular-nums">
											<span className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
												{formatMs(highlights.fastest.avg_ms)}
											</span>
											<span className="text-[11px] text-muted-foreground">
												抖动 ±{formatMs(highlights.fastest.jitter_ms, 1)} · 丢包{" "}
												{highlights.fastest.loss_percent.toFixed(1)}%
											</span>
										</div>
									</>
								) : (
									<div className="text-sm text-muted-foreground">—</div>
								)}
							</CardContent>
						</Card>

						{/* Most Stable Server */}
						<Card
							className={cn(
								"border-sky-500/30 shadow-2xs",
								customBackgroundImage && "bg-card/85 backdrop-blur-md",
							)}
						>
							<CardContent className="flex flex-col justify-between gap-2 p-4">
								<div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
									<span className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-400">
										<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
										{t("latencyMatrix.mostStableServer", "最稳定节点")}
									</span>
									<span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
										SCORE
									</span>
								</div>
								{highlights.mostStable ? (
									<>
										<Link
											to={`/server/${highlights.mostStable.id}`}
											className="flex items-center gap-1.5 truncate text-sm font-bold text-foreground hover:underline"
										>
											<ServerFlag
												country_code={highlights.mostStable.country_code}
											/>
											<span className="truncate">
												{highlights.mostStable.name}
											</span>
										</Link>
										<div className="flex items-baseline justify-between gap-2 tabular-nums">
											<span className="text-xl font-bold text-sky-700 dark:text-sky-400">
												{highlights.mostStable.stability_score?.toFixed(1)}
												<span className="ml-0.5 text-xs font-normal opacity-75">
													/100
												</span>
											</span>
											<span className="text-[11px] text-muted-foreground">
												均 {formatMs(highlights.mostStable.avg_ms, 0)} · 抖动 ±
												{formatMs(highlights.mostStable.jitter_ms, 1)}
											</span>
										</div>
									</>
								) : (
									<div className="text-sm text-muted-foreground">—</div>
								)}
							</CardContent>
						</Card>

						{/* Most Unstable Server */}
						<Card
							className={cn(
								"border-rose-500/35 shadow-2xs",
								customBackgroundImage && "bg-card/85 backdrop-blur-md",
							)}
						>
							<CardContent className="flex flex-col justify-between gap-2 p-4">
								<div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
									<span className="inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
										<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
										{t("latencyMatrix.mostUnstableServer", "最不稳定节点")}
									</span>
									<span className="rounded-full bg-rose-500/12 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300">
										ALERT
									</span>
								</div>
								{highlights.mostUnstable ? (
									<>
										<Link
											to={`/server/${highlights.mostUnstable.id}`}
											className="flex items-center gap-1.5 truncate text-sm font-bold text-foreground hover:underline"
										>
											<ServerFlag
												country_code={highlights.mostUnstable.country_code}
											/>
											<span className="truncate">
												{highlights.mostUnstable.name}
											</span>
										</Link>
										<div className="flex items-baseline justify-between gap-2 tabular-nums">
											<span
												className={cn(
													"text-xl font-bold",
													getStabilityMeta(
														highlights.mostUnstable.stability_score,
														true,
													).textClass,
												)}
											>
												{highlights.mostUnstable.stability_score?.toFixed(1)}
												<span className="ml-0.5 text-xs font-normal opacity-75">
													/100
												</span>
											</span>
											<span className="text-[11px] text-muted-foreground">
												抖动 ±{formatMs(highlights.mostUnstable.jitter_ms, 1)} ·
												丢包 {highlights.mostUnstable.loss_percent.toFixed(1)}%
											</span>
										</div>
									</>
								) : (
									<div className="text-sm text-muted-foreground">—</div>
								)}
							</CardContent>
						</Card>

						{/* Fleet Summary */}
						<Card
							className={cn(
								"border-border/70 shadow-2xs",
								customBackgroundImage && "bg-card/85 backdrop-blur-md",
							)}
						>
							<CardContent className="flex flex-col justify-between gap-2 p-4">
								<div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
									<span className="inline-flex items-center gap-1.5 text-foreground">
										<Gauge className="h-3.5 w-3.5" aria-hidden="true" />
										{t("latencyMatrix.fleetSummary", "全局网络概况")}
									</span>
									<span className="text-[11px] tabular-nums">
										{highlights.monitoredCount}/{scopedServers.length} 节点
									</span>
								</div>
								<div className="flex items-baseline gap-2 tabular-nums">
									<span className="text-xl font-bold text-foreground">
										{formatMs(highlights.fleetAvgMs)}
									</span>
									<span className="text-xs text-muted-foreground">
										全局均延迟
									</span>
								</div>
								<div className="flex items-center justify-between text-[11px] tabular-nums">
									<span className="text-muted-foreground">
										均抖动 ±{formatMs(highlights.fleetAvgJitterMs, 1)}
									</span>
									<span
										className={cn(
											"inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
											highlights.unstableCount > 0
												? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
												: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
										)}
									>
										{highlights.unstableCount > 0
											? `▲ ${highlights.unstableCount} 台存在波动`
											: "✓ 全线平稳"}
									</span>
								</div>
							</CardContent>
						</Card>
					</section>

					{/* Quick sort presets + filter bar */}
					<div
						className={cn(
							"flex flex-col gap-2.5 rounded-xl border border-border/70 bg-card p-3 shadow-2xs",
							customBackgroundImage && "bg-card/85 backdrop-blur-md",
						)}
					>
						<div className="flex flex-wrap items-center justify-between gap-2">
							{/* Quick ranking presets */}
							<div className="flex flex-wrap items-center gap-1.5">
								<span className="mr-1 text-xs font-medium text-muted-foreground">
									{t("latencyMatrix.quickRank", "一键排行：")}
								</span>
								<button
									type="button"
									aria-pressed={sortKey === "avg" && sortDir === "ascending"}
									onClick={() =>
										applyPresetSort("avg", "ascending", "延迟最低优先")
									}
									className={cn(
										"inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
										sortKey === "avg" && sortDir === "ascending"
											? "border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
											: "border-border bg-background text-muted-foreground hover:text-foreground",
									)}
								>
									<Zap className="h-3 w-3" aria-hidden="true" />
									<span>{t("latencyMatrix.sortFastest", "最低延迟优先")}</span>
								</button>
								<button
									type="button"
									aria-pressed={
										sortKey === "stability" && sortDir === "ascending"
									}
									onClick={() =>
										applyPresetSort("stability", "ascending", "最不稳优先")
									}
									className={cn(
										"inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
										sortKey === "stability" && sortDir === "ascending"
											? "border-rose-500/50 bg-rose-500/15 text-rose-800 dark:text-rose-300"
											: "border-border bg-background text-muted-foreground hover:text-foreground",
									)}
								>
									<Flame className="h-3 w-3" aria-hidden="true" />
									<span>{t("latencyMatrix.sortUnstable", "最不稳优先")}</span>
								</button>
								<button
									type="button"
									aria-pressed={sortKey === "loss" && sortDir === "descending"}
									onClick={() =>
										applyPresetSort("loss", "descending", "丢包最高优先")
									}
									className={cn(
										"inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
										sortKey === "loss" && sortDir === "descending"
											? "border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-300"
											: "border-border bg-background text-muted-foreground hover:text-foreground",
									)}
								>
									<AlertTriangle className="h-3 w-3" aria-hidden="true" />
									<span>{t("latencyMatrix.sortLoss", "丢包最高")}</span>
								</button>
								<button
									type="button"
									aria-pressed={sortKey === "jitter" && sortDir === "descending"}
									onClick={() =>
										applyPresetSort("jitter", "descending", "抖动最大优先")
									}
									className={cn(
										"inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
										sortKey === "jitter" && sortDir === "descending"
											? "border-violet-500/50 bg-violet-500/15 text-violet-800 dark:text-violet-300"
											: "border-border bg-background text-muted-foreground hover:text-foreground",
									)}
								>
									<Waves className="h-3 w-3" aria-hidden="true" />
									<span>{t("latencyMatrix.sortJitter", "抖动最大")}</span>
								</button>
							</div>

							{/* Search input */}
							<div className="relative w-full sm:w-56">
								<Search
									className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
									aria-hidden="true"
								/>
								<label htmlFor={searchId} className="sr-only">
									{t("latencyMatrix.searchPlaceholder", "搜索服务器名称")}
								</label>
								<input
									id={searchId}
									type="search"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder={t(
										"latencyMatrix.searchPlaceholder",
										"筛选服务器名称...",
									)}
									className="h-8 w-full rounded-full border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
								/>
							</div>
						</div>

						{/* Group & monitor scope row */}
						{(groupTabs.length > 1 || (hasDomestic && hasOverseas)) && (
							<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
								<div className="min-w-0 flex-1 overflow-x-auto">
									{groupTabs.length > 1 && (
										<GroupSwitch
											tabs={groupTabs}
											currentTab={currentGroup}
											setCurrentTab={setCurrentGroup}
										/>
									)}
								</div>
								{hasDomestic && hasOverseas && (
									<fieldset
										aria-label="探测线路范围"
										className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-muted/60 p-0.5 text-xs"
									>
										{(
											[
												{ key: "all", label: "全部线路" },
												{ key: "domestic", label: "国内三网" },
												{ key: "overseas", label: "海外节点" },
											] as const
										).map((item) => (
											<button
												key={item.key}
												type="button"
												aria-pressed={monitorScope === item.key}
												onClick={() => setMonitorScope(item.key)}
												className={cn(
													"rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
													monitorScope === item.key
														? "bg-card text-foreground shadow-2xs"
														: "text-muted-foreground hover:text-foreground",
												)}
											>
												{item.label}
											</button>
										))}
									</fieldset>
								)}
							</div>
						)}
					</div>

					{/* Accessible visually-hidden sort announcement region (never put aria-live on <table>) */}
					<div role="status" className="sr-sort-status">
						{sortAnnouncement}
					</div>

					{/* Main All-Servers Latency & Stability Matrix Table */}
					{monitors.length === 0 ? (
						<Card>
							<CardContent className="flex min-h-48 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
								<Activity className="h-8 w-8 opacity-40" aria-hidden="true" />
								<p>
									{t(
										"monitor.noData",
										"没有服务监控数据，请在管理后台服务页添加监控任务",
									)}
								</p>
							</CardContent>
						</Card>
					) : sortedServers.length === 0 ? (
						<Card>
							<CardContent className="flex min-h-40 items-center justify-center p-8 text-sm text-muted-foreground">
								{t("info.noMatchingServers", "没有符合当前筛选条件的服务器")}
							</CardContent>
						</Card>
					) : (
						<TooltipProvider delayDuration={150}>
							<section
								// biome-ignore lint/a11y/noNoninteractiveTabindex: required by responsive-table for keyboard scrolling
								tabIndex={0}
								aria-labelledby={captionId}
								className={cn(
									"latency-table-wrapper shadow-xs",
									customBackgroundImage && "bg-card/88 backdrop-blur-md",
								)}
							>
								<table className="latency-matrix-table">
									<caption id={captionId} className="sr-only">
										{t(
											"latencyMatrix.tableCaption",
											"全服务器网络延迟、抖动、丢包率与稳定性对比矩阵，点击列标题可排序",
										)}
									</caption>
									<thead>
										<tr>
											<th
												scope="col"
												aria-sort={sortKey === "name" ? sortDir : undefined}
											>
												<button
													type="button"
													onClick={() =>
														handleHeaderSort("name", "服务器", "ascending")
													}
												>
													<span>{t("latencyMatrix.colServer", "服务器")}</span>
													<SortArrowsIcon />
												</button>
											</th>
											<th
												scope="col"
												aria-sort={
													sortKey === "stability" ? sortDir : undefined
												}
											>
												<button
													type="button"
													onClick={() =>
														handleHeaderSort(
															"stability",
															"稳定性",
															"ascending",
														)
													}
												>
													<span>{t("latencyMatrix.colStability", "稳定性")}</span>
													<SortArrowsIcon />
												</button>
											</th>
											<th
												scope="col"
												aria-sort={sortKey === "avg" ? sortDir : undefined}
											>
												<button
													type="button"
													onClick={() =>
														handleHeaderSort("avg", "综合均延迟", "ascending")
													}
												>
													<span>{t("latencyMatrix.colAvg", "综合延迟")}</span>
													<SortArrowsIcon />
												</button>
											</th>
											<th
												scope="col"
												aria-sort={sortKey === "jitter" ? sortDir : undefined}
											>
												<button
													type="button"
													onClick={() =>
														handleHeaderSort("jitter", "抖动", "descending")
													}
												>
													<span>{t("latencyMatrix.colJitter", "抖动")}</span>
													<SortArrowsIcon />
												</button>
											</th>
											<th
												scope="col"
												aria-sort={sortKey === "loss" ? sortDir : undefined}
											>
												<button
													type="button"
													onClick={() =>
														handleHeaderSort("loss", "丢包率", "descending")
													}
												>
													<span>{t("latencyMatrix.colLoss", "丢包率")}</span>
													<SortArrowsIcon />
												</button>
											</th>
											{visibleMonitors.map((mon, idx) => {
												const colKey: LatencySortKey = `monitor:${mon.id}`;
												const meta =
													monitorMetaById.get(mon.id) ??
													detectMonitorMeta(mon.name);
												const seriesColor =
													SERIES_COLORS[idx % SERIES_COLORS.length];
												return (
													<th
														key={mon.id}
														scope="col"
														aria-sort={
															sortKey === colKey ? sortDir : undefined
														}
													>
														<button
															type="button"
															onClick={() =>
																handleHeaderSort(colKey, mon.name, "ascending")
															}
															title={`点击按「${mon.name}」延迟排序`}
														>
															<span className="flex min-w-0 items-center gap-1.5">
																<MonitorIdentityBadge
																	meta={meta}
																	seriesColor={seriesColor}
																	size="sm"
																/>
																<span className="max-w-28 truncate">
																	{mon.name}
																</span>
															</span>
															<SortArrowsIcon />
														</button>
													</th>
												);
											})}
										</tr>
									</thead>
									<tbody>
										{sortedServers.map((srv) => {
											const stab = getStabilityMeta(
												srv.stability_score,
												srv.monitor_count > 0,
											);
											const isPinned = pinnedServerIds?.includes(srv.id) ?? false;
											return (
												<tr key={srv.id}>
													<th scope="row">
														<div className="flex items-center justify-between gap-2">
															<div className="flex min-w-0 items-center gap-1.5">
																<span
																	title={srv.online ? "在线" : "离线"}
																	className={cn(
																		"h-2 w-2 shrink-0 rounded-full",
																		srv.online
																			? "bg-emerald-500"
																			: "bg-rose-500",
																	)}
																/>
																<ServerFlag country_code={srv.country_code} />
																<Link
																	to={`/server/${srv.id}`}
																	className="group inline-flex min-w-0 items-center gap-1 text-xs font-semibold text-foreground hover:text-primary"
																>
																	<span className="truncate">{srv.name}</span>
																	<ExternalLink
																		className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70"
																		aria-hidden="true"
																	/>
																</Link>
															</div>
															<button
																type="button"
																aria-pressed={isPinned}
																aria-label={`在对比图表中${isPinned ? "取消勾选" : "勾选"} ${srv.name}`}
																title={
																	isPinned
																		? "已加入下方曲线对比（点击取消）"
																		: "加入下方曲线对比"
																}
																onClick={() => handleTogglePinServer(srv.id)}
																className={cn(
																	"inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs transition-colors",
																	isPinned
																		? "border-primary bg-primary/15 text-primary"
																		: "border-transparent text-muted-foreground/60 hover:border-border hover:text-foreground",
																)}
															>
																<Pin className="h-3 w-3" aria-hidden="true" />
															</button>
														</div>
													</th>

													{/* Stability badge */}
													<td data-label="稳定性">
														<span
															className={cn(
																"latency-stability-badge inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
																stab.badgeClass,
															)}
														>
															<span aria-hidden="true">{stab.symbol}</span>
															<span>{stab.shortLabel}</span>
															{srv.stability_score != null && (
																<span className="font-mono text-[11px] opacity-90">
																	{srv.stability_score.toFixed(0)}
																</span>
															)}
														</span>
													</td>

													{/* Overall average & P95 */}
													<td data-label="综合延迟">
														<div className="flex flex-col leading-tight">
															<span className="text-xs font-bold text-foreground">
																{formatMs(srv.avg_ms)}
															</span>
															{srv.p95_ms != null && (
																<span className="text-[10px] text-muted-foreground">
																	P95 {formatMs(srv.p95_ms, 0)}
																</span>
															)}
														</div>
													</td>

													{/* Overall Jitter */}
													<td data-label="抖动">
														<span
															className={cn(
																"text-xs font-medium",
																(srv.jitter_ms ?? 0) >= 20
																	? "font-semibold text-rose-700 dark:text-rose-400"
																	: (srv.jitter_ms ?? 0) >= 8
																		? "text-amber-700 dark:text-amber-400"
																		: "text-foreground",
															)}
														>
															{srv.jitter_ms != null
																? `±${srv.jitter_ms.toFixed(1)}ms`
																: "—"}
														</span>
													</td>

													{/* Overall Loss */}
													<td data-label="丢包率">
														{srv.monitor_count === 0 ? (
															<span className="text-xs text-muted-foreground">
																—
															</span>
														) : (
															<span
																className={cn(
																	"inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
																	srv.loss_percent === 0
																		? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
																		: srv.loss_percent < 2
																			? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
																			: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
																)}
															>
																{srv.loss_percent > 0 && (
																	<span aria-hidden="true">▲</span>
																)}
																{srv.loss_percent.toFixed(2)}%
															</span>
														)}
													</td>

													{/* Per-monitor heatmap cells */}
													{visibleMonitors.map((mon) => {
														const cell = srv.cells?.[String(mon.id)];
														const heat = getCellHeatStyle(cell);
														if (!cell) {
															return (
																<td key={mon.id} data-label={mon.name}>
																	<div className="flex h-12 min-w-28 items-center justify-center rounded-lg border border-dashed border-border/50 text-[11px] text-muted-foreground/60">
																		—
																	</div>
																</td>
															);
														}
														return (
															<td key={mon.id} data-label={mon.name}>
																<Tooltip>
																	<TooltipTrigger asChild>
																		<button
																			type="button"
																			onClick={() => {
																				setSelectedMonitorId(mon.id);
																				handleTogglePinServer(srv.id);
																			}}
																			className={cn(
																				"latency-cell-pill flex min-w-28 flex-col gap-1 rounded-lg border px-2 py-1.5 text-left transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:hover:brightness-110",
																				heat.pillClass,
																			)}
																		>
																			<div className="flex items-center justify-between gap-2">
																				<span
																					className={cn(
																						"text-xs font-bold leading-none",
																						heat.delayClass,
																					)}
																				>
																					{cell.avg_ms != null
																						? `${cell.avg_ms.toFixed(1)}ms`
																						: "超时"}
																				</span>
																				<CellSparkline
																					points={cell.sparkline}
																					strokeColor={heat.strokeColor}
																				/>
																			</div>
																			<div className="flex items-center justify-between gap-1.5 text-[10px] leading-none text-muted-foreground">
																				<span>
																					±
																					{cell.jitter_ms != null
																						? `${cell.jitter_ms.toFixed(0)}ms`
																						: "—"}
																				</span>
																				{cell.loss_percent > 0 ? (
																					<span className="font-semibold text-rose-700 dark:text-rose-300">
																						▲{cell.loss_percent.toFixed(1)}%
																					</span>
																				) : cell.stability_score < 75 ? (
																					<span className="font-semibold text-amber-800 dark:text-amber-300">
																						波动
																					</span>
																				) : (
																					<span className="opacity-75">
																						0%丢包
																					</span>
																				)}
																			</div>
																		</button>
																	</TooltipTrigger>
																	<TooltipContent
																		side="top"
																		className="border border-border bg-popover p-3 text-popover-foreground shadow-lg"
																	>
																		<LatencyCellDetailTooltip
																			serverName={srv.name}
																			monitorName={mon.name}
																			cell={cell}
																		/>
																	</TooltipContent>
																</Tooltip>
															</td>
														);
													})}
												</tr>
											);
										})}
									</tbody>
								</table>
							</section>
						</TooltipProvider>
					)}

					{/* Multi-server comparison line chart on shared time axis */}
					{monitors.length > 0 && scopedServers.length > 0 && (
						<LatencyCompareChart
							monitors={visibleMonitors.length > 0 ? visibleMonitors : monitors}
							servers={scopedServers}
							period={period}
							selectedMonitorId={selectedMonitorId}
							onSelectMonitor={setSelectedMonitorId}
							pinnedServerIds={pinnedServerIds}
							onTogglePinServer={handleTogglePinServer}
							onSetPinnedServers={setPinnedServerIds}
							customBackgroundImage={customBackgroundImage}
						/>
					)}
				</>
			)}
		</div>
	);
}
