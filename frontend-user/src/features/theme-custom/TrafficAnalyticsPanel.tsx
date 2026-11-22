import { useQuery } from "@tanstack/react-query";
import { BarChart3, Monitor, PieChart, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { fetchService } from "@/lib/nezha-api";
import type { NezhaServer } from "@/types/nezha-api";
import {
	calculateRemainingDaysUntil,
	extractCycleTrafficMap,
	formatGB,
	parseServerBilling,
} from "./server-billing";

const CHART_COLORS = [
	"#3b82f6",
	"#10b981",
	"#f59e0b",
	"#ef4444",
	"#8b5cf6",
	"#ec4899",
	"#06b6d4",
	"#84cc16",
	"#f43f5e",
	"#a855f7",
	"#14b8a6",
	"#f97316",
	"#0ea5e9",
	"#6366f1",
	"#d946ef",
	"#22c55e",
];

type SortKey =
	| "used"
	| "remain"
	| "total"
	| "pct"
	| "daily"
	| "dailyUsed"
	| "projected";

interface LimitedServerTraffic {
	id: number;
	name: string;
	used: number; // GB
	total: number; // GB
	remain: number; // GB
	pct: number;
	daysRemain: number;
	dailyRemain: number;
	dailyUsedSoFar: number;
	projectedTotal: number;
	histTotal: number; // GB
	isUnlim: false;
	colorIdx: number;
}

interface UnlimitedServerTraffic {
	id: number;
	name: string;
	used: number; // GB
	histTotal: number; // GB
	isUnlim: true;
	colorIdx: number;
}

type ServerTrafficEntry = LimitedServerTraffic | UnlimitedServerTraffic;

function buildConicGradient(
	items: Array<{ used: number; colorIdx: number }>,
	totalUsed: number,
): string {
	if (totalUsed <= 0 || items.length === 0) {
		return "conic-gradient(hsl(var(--border)) 0deg 360deg)";
	}
	const stops: string[] = [];
	let deg = 0;
	for (const item of items) {
		const slice = (item.used / totalUsed) * 360;
		const color = CHART_COLORS[item.colorIdx % CHART_COLORS.length];
		stops.push(`${color} ${deg.toFixed(2)}deg ${(deg + slice).toFixed(2)}deg`);
		deg += slice;
	}
	return `conic-gradient(${stops.join(", ")})`;
}

export function TrafficAnalyticsPanel({
	open,
	onClose,
	servers,
}: {
	open: boolean;
	onClose: () => void;
	servers: NezhaServer[];
}) {
	const { pathname } = useLocation();
	const [sortBy, setSortBy] = useState<SortKey>("used");

	const { data: serviceData } = useQuery({
		queryKey: ["service"],
		queryFn: () => fetchService(),
		enabled: open,
		retry: false,
	});

	const detailMatch = pathname.match(/\/server\/(\d+)/);
	const detailServerId = detailMatch ? Number(detailMatch[1]) : null;

	const analytics = useMemo(() => {
		const cycleMap = extractCycleTrafficMap(
			serviceData?.data?.cycle_transfer_stats,
		);
		let limTotal = 0;
		let limUsed = 0;
		let unlimUsed = 0;
		const limSrvs: LimitedServerTraffic[] = [];
		const unlimSrvs: UnlimitedServerTraffic[] = [];

		for (const srv of servers) {
			const cycle = cycleMap.get(srv.id);
			const billing = parseServerBilling(srv);
			const histTotalGB =
				((srv.state?.net_in_transfer || 0) +
					(srv.state?.net_out_transfer || 0)) /
				1024 ** 3;

			const isPlanUnlimited =
				billing?.trafficVol && /无限|不限|unlimited/i.test(billing.trafficVol);

			if (!cycle) {
				if (isPlanUnlimited) {
					unlimUsed += histTotalGB;
					unlimSrvs.push({
						id: srv.id,
						name: srv.name,
						used: histTotalGB,
						histTotal: histTotalGB,
						isUnlim: true,
						colorIdx: 0,
					});
				}
				continue;
			}

			const usedGB = cycle.transfer / 1024 ** 3;
			const totalGB = cycle.max / 1024 ** 3;
			const totalPB = totalGB / (1024 * 1024);

			if (isPlanUnlimited || totalPB > 16000) {
				unlimUsed += usedGB;
				unlimSrvs.push({
					id: srv.id,
					name: srv.name,
					used: usedGB,
					histTotal: histTotalGB,
					isUnlim: true,
					colorIdx: 0,
				});
			} else {
				limTotal += totalGB;
				limUsed += usedGB;
				const remainGB = Math.max(0, totalGB - usedGB);
				const pct =
					totalGB > 0 ? Number(((usedGB / totalGB) * 100).toFixed(2)) : 0;

				let daysRemain = calculateRemainingDaysUntil(cycle.to);
				if (
					daysRemain === 0 &&
					billing?.remainingDays &&
					billing.remainingDays > 0
				) {
					daysRemain =
						billing.period === "month"
							? billing.remainingDays
							: billing.remainingDays % 30 || 30;
				}

				const dailyRemain = daysRemain > 0 ? remainGB / daysRemain : 0;
				const currentMonthRemain =
					daysRemain > 0 ? (daysRemain % 30 === 0 ? 30 : daysRemain % 30) : 0;
				const daysPassed = Math.max(
					1,
					daysRemain > 0 ? 30 - currentMonthRemain : 1,
				);
				const dailyUsedSoFar = usedGB / daysPassed;
				const projectedTotal = usedGB + dailyUsedSoFar * currentMonthRemain;

				limSrvs.push({
					id: srv.id,
					name: srv.name,
					used: usedGB,
					total: totalGB,
					remain: remainGB,
					pct,
					daysRemain,
					dailyRemain,
					dailyUsedSoFar,
					projectedTotal,
					histTotal: histTotalGB,
					isUnlim: false,
					colorIdx: 0,
				});
			}
		}

		limSrvs.sort((a, b) => b.used - a.used);
		unlimSrvs.sort((a, b) => b.used - a.used);
		limSrvs.forEach((s, i) => {
			s.colorIdx = i;
		});
		unlimSrvs.forEach((s, i) => {
			s.colorIdx = i;
		});

		const donutLimBg = buildConicGradient(limSrvs, limUsed);
		const donutUnlimBg = buildConicGradient(unlimSrvs, unlimUsed);

		const sortedLim = [...limSrvs].sort((a, b) => {
			switch (sortBy) {
				case "remain":
					return b.remain - a.remain;
				case "total":
					return b.total - a.total;
				case "pct":
					return b.pct - a.pct;
				case "daily":
					return b.dailyRemain - a.dailyRemain;
				case "dailyUsed":
					return b.dailyUsedSoFar - a.dailyUsedSoFar;
				case "projected":
					return b.projectedTotal - a.projectedTotal;
				default:
					return b.used - a.used;
			}
		});

		const allEntries: ServerTrafficEntry[] = [...limSrvs, ...unlimSrvs];
		const detailServer =
			detailServerId !== null
				? (allEntries.find((s) => s.id === detailServerId) ?? null)
				: null;

		return {
			limTotal,
			limUsed,
			limRemain: Math.max(0, limTotal - limUsed),
			limPct: limTotal > 0 ? ((limUsed / limTotal) * 100).toFixed(2) : "0",
			limCount: limSrvs.length,
			unlimUsed,
			unlimCount: unlimSrvs.length,
			sortedLim,
			unlimSrvs,
			donutLimBg,
			donutUnlimBg,
			detailServer,
		};
	}, [
		servers,
		serviceData?.data?.cycle_transfer_stats,
		sortBy,
		detailServerId,
	]);

	if (!open) return null;

	const single = analytics.detailServer;

	return (
		<aside
			aria-label={single ? "单机流量透视" : "全维度流量透视"}
			className="fixed right-5 top-20 z-50 flex max-h-[calc(100dvh-100px)] w-[460px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/95 text-foreground shadow-2xl backdrop-blur-xl"
		>
			<div className="flex items-center justify-between border-b border-border/50 bg-muted/25 px-5 py-3.5">
				<h3 className="flex items-center gap-2 text-base font-bold">
					{single ? (
						<>
							<Monitor className="h-4 w-4 text-primary" />
							单机流量透视
						</>
					) : (
						<>
							<PieChart className="h-4 w-4 text-primary" />
							全维度流量透视
						</>
					)}
				</h3>
				<button
					type="button"
					aria-label="关闭流量透视"
					onClick={onClose}
					className="rounded-md p-1 text-muted-foreground transition-transform hover:rotate-90 hover:text-foreground"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="nz-thin-scroll flex flex-1 flex-col gap-5 overflow-y-auto p-5">
				{single ? (
					<SingleServerTrafficView srv={single} />
				) : analytics.limCount === 0 && analytics.unlimCount === 0 ? (
					<div className="flex flex-col items-center py-10 text-center text-sm text-muted-foreground">
						<BarChart3 className="mb-3 h-10 w-10 opacity-40" />
						<p className="font-semibold text-foreground">
							暂无周期流量统计数据
						</p>
						<p className="mt-1 text-xs">
							请在后台为服务器配置周期流量告警规则或套餐备注
						</p>
					</div>
				) : (
					<>
						{/* Summary Grid */}
						<div className="grid grid-cols-2 gap-x-5 gap-y-2 rounded-lg bg-muted/30 p-3 text-xs">
							<div className="flex justify-between">
								<span className="text-muted-foreground">限量池消耗</span>
								<span className="font-mono font-bold">
									{formatGB(analytics.limUsed)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">剩余总额度</span>
								<span className="font-mono font-bold text-emerald-500">
									{formatGB(analytics.limRemain)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">整体使用率</span>
								<span className="font-mono font-bold">{analytics.limPct}%</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">限量机数量</span>
								<span className="font-mono font-bold">
									{analytics.limCount} 台
								</span>
							</div>
							<div className="col-span-2 my-0.5 border-t border-dashed border-border" />
							<div className="flex justify-between">
								<span className="text-muted-foreground">无限池消耗</span>
								<span className="font-mono font-bold text-violet-500">
									{formatGB(analytics.unlimUsed)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">无限机数量</span>
								<span className="font-mono font-bold">
									{analytics.unlimCount} 台
								</span>
							</div>
						</div>

						{/* Dual Donuts */}
						<div className="flex flex-col items-center justify-around gap-4 sm:flex-row">
							<div className="flex flex-col items-center gap-2">
								<span className="text-xs font-semibold">限量机使用池分布</span>
								<div
									className="relative flex h-[116px] w-[116px] items-center justify-center rounded-full shadow-inner"
									style={{ background: analytics.donutLimBg }}
								>
									<div className="flex h-[74px] w-[74px] flex-col items-center justify-center rounded-full bg-card text-center shadow-inner">
										<span className="text-xs font-extrabold">
											{formatGB(analytics.limUsed)}
										</span>
										<span className="text-[10px] text-muted-foreground">
											总使用量
										</span>
									</div>
								</div>
							</div>
							<div className="flex flex-col items-center gap-2">
								<span className="text-xs font-semibold">无限机流量池分布</span>
								<div
									className="relative flex h-[116px] w-[116px] items-center justify-center rounded-full shadow-inner"
									style={{ background: analytics.donutUnlimBg }}
								>
									<div className="flex h-[74px] w-[74px] flex-col items-center justify-center rounded-full bg-card text-center shadow-inner">
										<span className="text-xs font-extrabold">
											{formatGB(analytics.unlimUsed)}
										</span>
										<span className="text-[10px] text-violet-500">总跑流</span>
									</div>
								</div>
							</div>
						</div>

						{/* Limited List */}
						{analytics.sortedLim.length > 0 && (
							<div className="space-y-2 border-t border-border/60 pt-4">
								<div className="flex items-center justify-between">
									<span className="border-l-2 border-primary pl-2 text-xs font-bold">
										限量池明细
									</span>
									<select
										aria-label="排序方式"
										value={sortBy}
										onChange={(e) => setSortBy(e.target.value as SortKey)}
										className="rounded border border-border/70 bg-background px-2 py-0.5 text-xs outline-none"
									>
										<option value="used">已用流量降序</option>
										<option value="remain">剩余流量降序</option>
										<option value="total">总计流量降序</option>
										<option value="pct">使用占比降序</option>
										<option value="daily">配额日均降序</option>
										<option value="dailyUsed">当前耗速降序</option>
										<option value="projected">月末预计降序</option>
									</select>
								</div>

								<div className="space-y-2">
									{analytics.sortedLim.map((srv) => {
										const color =
											CHART_COLORS[srv.colorIdx % CHART_COLORS.length];
										const willExceed =
											srv.daysRemain > 0 && srv.projectedTotal > srv.total;
										return (
											<div
												key={srv.id}
												className="space-y-1.5 rounded-lg border border-border/60 bg-card/60 p-2.5 text-xs"
											>
												<div className="flex items-center gap-2 font-semibold">
													<span
														className="h-2 w-2 shrink-0 rounded-full"
														style={{ backgroundColor: color }}
													/>
													<span className="break-all">{srv.name}</span>
												</div>
												<div className="ml-4 space-y-1 rounded-md bg-muted/35 px-2.5 py-1.5 text-[11px] text-muted-foreground">
													<div className="flex justify-between gap-2">
														<span>
															已用:{" "}
															<b className="font-mono text-foreground">
																{formatGB(srv.used)}
															</b>
														</span>
														<span>
															剩余:{" "}
															<b className="font-mono text-foreground">
																{formatGB(srv.remain)}
															</b>
														</span>
														<span>
															总量:{" "}
															<b className="font-mono text-foreground">
																{formatGB(srv.total)}
															</b>
														</span>
													</div>
													<div className="flex justify-between gap-2 border-t border-dashed border-border/60 pt-1">
														<span>
															占比:{" "}
															<b className="font-mono text-foreground">
																{srv.pct}%
															</b>
														</span>
														<span>
															重置:{" "}
															<b
																className={
																	srv.daysRemain > 0
																		? "text-emerald-500"
																		: "text-amber-500"
																}
															>
																{srv.daysRemain > 0
																	? `${srv.daysRemain} 天`
																	: "今天"}
															</b>
														</span>
														<span>
															日均配额:{" "}
															<b className="font-mono text-emerald-500">
																{srv.daysRemain > 0
																	? `${formatGB(srv.dailyRemain)}/天`
																	: "-"}
															</b>
														</span>
													</div>
													<div className="flex items-center justify-between gap-2 border-t border-dotted border-border/60 pt-1 text-foreground">
														<span>
															耗速:{" "}
															<b className="font-mono">
																{formatGB(srv.dailyUsedSoFar)}/天
															</b>
														</span>
														<span>
															预计月末:{" "}
															<b
																className={`font-mono ${willExceed ? "text-red-500" : ""}`}
															>
																{formatGB(srv.projectedTotal)}
															</b>
														</span>
														{srv.daysRemain > 0 ? (
															willExceed ? (
																<span className="rounded border border-red-500/30 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-500">
																	⚠️ 预计超额
																</span>
															) : (
																<span className="rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">
																	✅ 健康受控
																</span>
															)
														) : (
															<span className="rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">
																🔄 即将重置
															</span>
														)}
													</div>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						)}

						{/* Unlimited List */}
						{analytics.unlimSrvs.length > 0 && (
							<div className="space-y-2 border-t border-border/60 pt-4">
								<span className="block border-l-2 border-violet-500 pl-2 text-xs font-bold">
									无限池明细
								</span>
								{analytics.unlimSrvs.map((srv) => (
									<div
										key={srv.id}
										className="space-y-1.5 rounded-lg border border-border/60 bg-card/60 p-2.5 text-xs"
									>
										<div className="flex items-center gap-2 font-semibold">
											<span
												className="h-2 w-2 shrink-0 rounded-full"
												style={{
													backgroundColor:
														CHART_COLORS[srv.colorIdx % CHART_COLORS.length],
												}}
											/>
											<span className="break-all">{srv.name}</span>
											<span className="rounded border border-yellow-500/30 bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-bold text-yellow-500">
												无限
											</span>
										</div>
										<div className="ml-4 flex justify-between rounded-md bg-muted/35 px-2.5 py-1.5 text-[11px] text-muted-foreground">
											<span>
												周期已用:{" "}
												<b className="font-mono text-foreground">
													{formatGB(srv.used)}
												</b>
											</span>
											<span>
												累计跑流:{" "}
												<b className="font-mono text-yellow-500">
													{formatGB(srv.histTotal)}
												</b>
											</span>
										</div>
									</div>
								))}
							</div>
						)}
					</>
				)}
			</div>
		</aside>
	);
}

function SingleServerTrafficView({ srv }: { srv: ServerTrafficEntry }) {
	const color = srv.isUnlim ? "#8b5cf6" : srv.pct > 85 ? "#ef4444" : "#3b82f6";
	const deg = srv.isUnlim ? 360 : Math.min(360, srv.pct * 3.6);

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-5">
				<div
					className="relative flex h-[140px] w-[140px] shrink-0 items-center justify-center rounded-full shadow-md"
					style={{
						background: `conic-gradient(${color} 0deg, ${color} ${deg}deg, hsl(var(--border)) ${deg}deg 360deg)`,
					}}
				>
					<div className="flex h-[94px] w-[94px] flex-col items-center justify-center rounded-full bg-card text-center">
						<span className="text-xl font-extrabold">
							{srv.isUnlim ? "∞" : `${srv.pct}%`}
						</span>
						<span className="text-[10px] text-muted-foreground">
							{srv.isUnlim ? "无限流量" : "已用比例"}
						</span>
					</div>
				</div>
				<div className="flex-1 space-y-1.5 text-xs">
					<h4 className="border-b border-dashed border-border pb-1.5 text-sm font-bold break-all">
						{srv.name}
					</h4>
					{srv.isUnlim ? (
						<>
							<div className="flex justify-between">
								<span className="text-muted-foreground">已用流量:</span>
								<span className="font-mono font-bold">
									{formatGB(srv.used)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">累计跑流:</span>
								<span className="font-mono font-bold text-yellow-500">
									{formatGB(srv.histTotal)}
								</span>
							</div>
						</>
					) : (
						<>
							<div className="flex justify-between">
								<span className="text-muted-foreground">已用流量:</span>
								<span className="font-mono font-bold">
									{formatGB(srv.used)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">剩余流量:</span>
								<span className="font-mono font-bold">
									{formatGB(srv.remain)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">总计流量:</span>
								<span className="font-mono font-bold">
									{formatGB(srv.total)}
								</span>
							</div>
							<div className="flex justify-between border-t border-dashed border-border pt-1">
								<span className="text-muted-foreground">距离重置:</span>
								<span className="font-bold text-emerald-500">
									{srv.daysRemain > 0 ? `${srv.daysRemain} 天` : "今天"}
								</span>
							</div>
						</>
					)}
				</div>
			</div>

			{srv.isUnlim ? (
				<div className="rounded-lg border-l-4 border-violet-500 bg-muted/30 p-3 text-xs text-muted-foreground">
					✅ 这是一台<b className="text-foreground">无限流量</b>
					服务器，请尽情使用，无需担心超额跑量。
				</div>
			) : (
				<div
					className="space-y-1.5 rounded-lg border-l-4 bg-muted/30 p-3 text-xs"
					style={{ borderColor: color }}
				>
					<div className="font-bold">💡 智能消耗诊断</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">历史日均消耗:</span>
						<b className="font-mono">{formatGB(srv.dailyUsedSoFar)}/天</b>
					</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">当前速率月末预计:</span>
						<b className="font-mono">{formatGB(srv.projectedTotal)}</b>
					</div>
					{srv.daysRemain > 0 && srv.projectedTotal > srv.total ? (
						<p className="pt-1 font-semibold text-red-500">
							⚠️ 警告：按当前消耗速度，预计{" "}
							<b>
								{srv.dailyUsedSoFar > 0
									? (srv.remain / srv.dailyUsedSoFar).toFixed(0)
									: 0}{" "}
								天后
							</b>{" "}
							流量将耗尽！
						</p>
					) : srv.daysRemain > 0 ? (
						<p className="pt-1 font-semibold text-emerald-500">
							✅ 健康：消耗受控，按当前速率重置时预计结余{" "}
							<b>{formatGB(srv.total - srv.projectedTotal)}</b>。
						</p>
					) : (
						<p className="pt-1 font-semibold text-amber-500">
							🔄 流量即将重置或正在刷新周期中。
						</p>
					)}
				</div>
			)}
		</div>
	);
}
