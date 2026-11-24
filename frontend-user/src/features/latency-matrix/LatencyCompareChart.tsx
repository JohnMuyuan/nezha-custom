import { Activity, Check, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import ServerFlag from "@/components/ServerFlag";
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
	detectMonitorMeta,
	MonitorIdentityBadge,
} from "@/features/network-monitor/monitor-icons";
import { cn, formatTime } from "@/lib/utils";
import type {
	LatencyOverviewMonitor,
	LatencyOverviewServer,
	LatencyPeriod,
} from "@/types/nezha-api";
import { formatMs, getStabilityMeta } from "./stability";

const CHART_PALETTE = [
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

function getDefaultSelectedServerIds(
	servers: LatencyOverviewServer[],
	monitorId: number,
): number[] {
	const available = servers.filter((s) => {
		const cell = s.cells?.[String(monitorId)];
		return (cell?.sparkline?.length ?? 0) > 0;
	});
	if (available.length <= 6) {
		return available.map((s) => s.id);
	}
	// Pick 3 lowest-latency + 3 most-unstable servers so contrast is immediate
	const byFast = [...available].sort(
		(a, b) =>
			(a.cells[String(monitorId)]?.avg_ms ?? Infinity) -
			(b.cells[String(monitorId)]?.avg_ms ?? Infinity),
	);
	const byUnstable = [...available].sort(
		(a, b) =>
			(a.cells[String(monitorId)]?.stability_score ?? 101) -
			(b.cells[String(monitorId)]?.stability_score ?? 101),
	);
	const picked = new Set<number>();
	for (const s of byFast.slice(0, 3)) picked.add(s.id);
	for (const s of byUnstable.slice(0, 3)) picked.add(s.id);
	return Array.from(picked);
}

export function LatencyCompareChart({
	monitors,
	servers,
	period,
	selectedMonitorId,
	onSelectMonitor,
	pinnedServerIds,
	onTogglePinServer,
	onSetPinnedServers,
	customBackgroundImage,
}: {
	monitors: LatencyOverviewMonitor[];
	servers: LatencyOverviewServer[];
	period: LatencyPeriod;
	selectedMonitorId: number | null;
	onSelectMonitor: (id: number) => void;
	pinnedServerIds: number[] | null;
	onTogglePinServer: (id: number) => void;
	onSetPinnedServers: (ids: number[] | null) => void;
	customBackgroundImage?: string;
}) {
	const { t } = useTranslation();
	const activeMonitorId = selectedMonitorId ?? monitors[0]?.id ?? null;

	const serversWithData = useMemo(() => {
		if (activeMonitorId == null) return [];
		return servers.filter((s) => {
			const cell = s.cells?.[String(activeMonitorId)];
			return (cell?.sparkline?.length ?? 0) > 0;
		});
	}, [servers, activeMonitorId]);

	const effectiveServerIds = useMemo(() => {
		if (activeMonitorId == null) return [];
		if (pinnedServerIds !== null) {
			const validSet = new Set(serversWithData.map((s) => s.id));
			return pinnedServerIds.filter((id) => validSet.has(id));
		}
		return getDefaultSelectedServerIds(serversWithData, activeMonitorId);
	}, [pinnedServerIds, serversWithData, activeMonitorId]);

	const [hasExplicitEmpty, setHasExplicitEmpty] = useState(false);
	useEffect(() => {
		if (pinnedServerIds === null || pinnedServerIds.length > 0) {
			setHasExplicitEmpty(false);
		}
	}, [pinnedServerIds]);

	const activeServers = useMemo(() => {
		const set = new Set(effectiveServerIds);
		return serversWithData.filter((s) => set.has(s.id));
	}, [serversWithData, effectiveServerIds]);

	const colorByServerId = useMemo(() => {
		const map = new Map<number, string>();
		serversWithData.forEach((s, idx) => {
			map.set(s.id, CHART_PALETTE[idx % CHART_PALETTE.length]);
		});
		return map;
	}, [serversWithData]);

	const { chartRows, chartConfig } = useMemo(() => {
		if (activeMonitorId == null || activeServers.length === 0) {
			return { chartRows: [], chartConfig: {} as ChartConfig };
		}
		const tsMap = new Map<number, Record<string, number | null>>();
		const config: ChartConfig = {};

		for (const srv of activeServers) {
			const key = `s_${srv.id}`;
			config[key] = {
				label: srv.name,
				color: colorByServerId.get(srv.id) ?? CHART_PALETTE[0],
			};
			const spark = srv.cells?.[String(activeMonitorId)]?.sparkline ?? [];
			for (const pt of spark) {
				let row = tsMap.get(pt.ts);
				if (!row) {
					row = { ts: pt.ts };
					tsMap.set(pt.ts, row);
				}
				row[key] = pt.delay;
			}
		}

		const rows = Array.from(tsMap.values()).sort(
			(a, b) => Number(a.ts) - Number(b.ts),
		);
		return { chartRows: rows, chartConfig: config };
	}, [activeMonitorId, activeServers, colorByServerId]);

	if (monitors.length === 0 || activeMonitorId == null) {
		return null;
	}

	const formatTick = (ts: number) => {
		const d = new Date(ts);
		if (period === "7d") {
			return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:00`;
		}
		return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	};

	const activeMonitor = monitors.find((m) => m.id === activeMonitorId);

	return (
		<Card
			className={cn(
				"border-border/70 shadow-xs",
				customBackgroundImage && "bg-card/85 backdrop-blur-md",
			)}
		>
			<CardHeader className="gap-3 pb-3">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div>
						<CardTitle className="flex items-center gap-2 text-base">
							<Activity className="h-4 w-4 text-primary" aria-hidden="true" />
							{t("latencyMatrix.compareChartTitle", "多服务器同轴延迟曲线对比")}
						</CardTitle>
						<CardDescription className="mt-0.5 text-xs">
							{t(
								"latencyMatrix.compareChartDesc",
								"选择同一条探测线路，直接对比各服务器在相同时间轴上的延迟高低与波动幅度",
							)}
						</CardDescription>
					</div>
					<div className="flex flex-wrap items-center gap-1.5">
						<button
							type="button"
							onClick={() => onSetPinnedServers(null)}
							className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<RotateCcw className="h-3 w-3" aria-hidden="true" />
							{t("latencyMatrix.presetContrast", "最快 vs 最不稳")}
						</button>
						<button
							type="button"
							onClick={() =>
								onSetPinnedServers(serversWithData.map((s) => s.id))
							}
							className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							{t("latencyMatrix.selectAll", "全选")} ({serversWithData.length})
						</button>
						<button
							type="button"
							onClick={() => {
								setHasExplicitEmpty(true);
								onSetPinnedServers([]);
							}}
							className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							{t("latencyMatrix.clearAll", "清空")}
						</button>
					</div>
				</div>

				{/* Monitor target selector pills */}
				<div
					role="tablist"
					aria-label={t("latencyMatrix.selectTarget", "选择对比探测线路")}
					className="flex flex-wrap gap-1.5"
				>
					{monitors.map((mon, idx) => {
						const meta = detectMonitorMeta(mon.name);
						const isActive = mon.id === activeMonitorId;
						const seriesColor = CHART_PALETTE[idx % CHART_PALETTE.length];
						return (
							<button
								key={mon.id}
								type="button"
								role="tab"
								aria-selected={isActive}
								onClick={() => onSelectMonitor(mon.id)}
								className={cn(
									"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
									isActive
										? "border-primary bg-primary/10 text-foreground shadow-2xs"
										: "border-border/70 bg-background/70 text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							>
								<MonitorIdentityBadge
									meta={meta}
									seriesColor={seriesColor}
									size="sm"
								/>
								<span className="max-w-36 truncate">{mon.name}</span>
							</button>
						);
					})}
				</div>

				{/* Server toggle chips */}
				{serversWithData.length > 0 && (
					<div className="flex flex-wrap gap-1.5 pt-1">
						{serversWithData.map((srv) => {
							const selected = effectiveServerIds.includes(srv.id);
							const cell = srv.cells?.[String(activeMonitorId)];
							const stab = getStabilityMeta(cell?.stability_score, !!cell);
							const color = colorByServerId.get(srv.id) ?? CHART_PALETTE[0];
							return (
								<button
									key={srv.id}
									type="button"
									aria-pressed={selected}
									onClick={() => onTogglePinServer(srv.id)}
									className={cn(
										"inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
										selected
											? "border-primary/60 bg-primary/8 text-foreground font-medium"
											: "border-border/60 bg-background/50 text-muted-foreground opacity-70 hover:opacity-100",
									)}
								>
									<span
										aria-hidden="true"
										className="h-2 w-2 shrink-0 rounded-full"
										style={{ backgroundColor: color }}
									/>
									<ServerFlag country_code={srv.country_code} />
									<span className="max-w-28 truncate">{srv.name}</span>
									<span className="tabular-nums text-[11px] opacity-80">
										{formatMs(cell?.avg_ms, 0)}
									</span>
									{stab.tier === "unstable" || stab.tier === "shaky" ? (
										<span
											className={cn("text-[10px] font-semibold", stab.textClass)}
										>
											{stab.symbol}
										</span>
									) : null}
									{selected && (
										<Check className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
									)}
								</button>
							);
						})}
					</div>
				)}
			</CardHeader>

			<CardContent className="pt-0">
				{activeServers.length === 0 || chartRows.length === 0 ? (
					<div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
						{hasExplicitEmpty
							? t("latencyMatrix.pickServersHint", "请点击上方服务器标签加入曲线对比")
							: t(
									"latencyMatrix.noCurveData",
									`当前线路「${activeMonitor?.name ?? ""}」在所选时间段暂无曲线样本`,
								)}
					</div>
				) : (
					<ChartContainer
						config={chartConfig}
						className="aspect-auto h-72 w-full sm:h-80"
					>
						<LineChart
							accessibilityLayer
							data={chartRows}
							margin={{ left: 8, right: 12, top: 8, bottom: 4 }}
						>
							<CartesianGrid vertical={false} strokeDasharray="3 3" />
							<XAxis
								dataKey="ts"
								tickLine={false}
								axisLine={false}
								tickMargin={8}
								minTickGap={48}
								tickFormatter={(value) => formatTick(Number(value))}
							/>
							<YAxis
								tickLine={false}
								axisLine={false}
								width={48}
								tickFormatter={(value) => `${value}ms`}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										labelFormatter={(_, payload) => {
											const rawTs = payload?.[0]?.payload?.ts;
											return rawTs ? formatTime(Number(rawTs)) : "";
										}}
										formatter={(value, name) => {
											const key = String(name);
											const label = chartConfig[key]?.label ?? key;
											const num = Number(value);
											return (
												<div className="flex w-full items-center justify-between gap-4 tabular-nums">
													<span className="truncate text-muted-foreground">
														{label}
													</span>
													<span className="font-mono font-semibold text-foreground">
														{Number.isFinite(num)
															? `${num.toFixed(1)} ms`
															: "—"}
													</span>
												</div>
											);
										}}
									/>
								}
							/>
							<ChartLegend content={<ChartLegendContent />} />
							{activeServers.map((srv) => {
								const key = `s_${srv.id}`;
								return (
									<Line
										key={key}
										type="monotone"
										dataKey={key}
										name={key}
										stroke={colorByServerId.get(srv.id) ?? CHART_PALETTE[0]}
										strokeWidth={2}
										dot={false}
										activeDot={{ r: 3.5 }}
										connectNulls={false}
										isAnimationActive={false}
									/>
								);
							})}
						</LineChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}
