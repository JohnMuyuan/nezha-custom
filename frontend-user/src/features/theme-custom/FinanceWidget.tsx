import { BarChart3, Building2, RefreshCw, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { safeLocalStorage } from "@/lib/storage";
import type { NezhaServer } from "@/types/nezha-api";
import {
	CURRENCY_SYMBOLS,
	type CurrencyCode,
	convertToCNY,
	DEFAULT_EXCHANGE_RATES,
	fetchExchangeRates,
	parseServerBilling,
} from "./server-billing";
import { useThemeConfig } from "./theme-config";

const CURRENCIES: Array<{ value: CurrencyCode; label: string }> = [
	{ value: "CNY", label: "CNY (￥)" },
	{ value: "USD", label: "USD ($)" },
	{ value: "HKD", label: "HKD (HK$)" },
	{ value: "EUR", label: "EUR (€)" },
	{ value: "GBP", label: "GBP (£)" },
];

type FinanceTab = "overview" | "cashflow" | "ranking";

interface MonthlyCashflowBucket {
	key: string; // YYYY-MM
	label: string; // MM月
	totalCNY: number;
	items: Array<{ id: number; name: string; amountCNY: number; day: number }>;
}

interface GroupRankItem {
	name: string;
	count: number;
	monthlyCNY: number;
	pct: number;
}

export function FinanceWidget({
	open,
	onClose,
	servers,
}: {
	open: boolean;
	onClose: () => void;
	servers: NezhaServer[];
}) {
	const { finance_widget, remaining_value } = useThemeConfig();
	const [tab, setTab] = useState<FinanceTab>("overview");
	const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
	const [rates, setRates] = useState<Record<string, number>>(
		DEFAULT_EXCHANGE_RATES,
	);
	const [spinning, setSpinning] = useState(false);
	const [currency, setCurrency] = useState<CurrencyCode>(() => {
		const saved = safeLocalStorage.getItem(
			"fin_currency",
		) as CurrencyCode | null;
		if (saved && saved in CURRENCY_SYMBOLS) return saved;
		return finance_widget.default_currency || "CNY";
	});

	useEffect(() => {
		const saved = safeLocalStorage.getItem("fin_currency");
		if (!saved && finance_widget.default_currency) {
			setCurrency(finance_widget.default_currency);
		}
	}, [finance_widget.default_currency]);

	const refreshRates = useCallback(async () => {
		setSpinning(true);
		const next = await fetchExchangeRates();
		setRates(next);
		setTimeout(() => setSpinning(false), 450);
	}, []);

	useEffect(() => {
		if (open) {
			void fetchExchangeRates().then(setRates);
		}
	}, [open]);

	const billingSig = servers
		.map((s) => `${s.id}:${s.name}:${s.country_code}:${s.public_note ?? ""}`)
		.join("|");

	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by billingSig so 1s WS ticks skip re-parsing
	const summary = useMemo(() => {
		let monthlyCostCNY = 0;
		let monthlyOutflowCNY = 0;
		let totalAssetCNY = 0;
		let totalRemainValCNY = 0;
		const details: Array<{ id: number; name: string; costCNY: number }> = [];

		// Prepare 12-month cashflow buckets starting from current month
		const now = new Date();
		const baseYear = now.getFullYear();
		const baseMonth = now.getMonth();
		const buckets: MonthlyCashflowBucket[] = [];
		const bucketMap = new Map<string, MonthlyCashflowBucket>();
		for (let offset = 0; offset < 12; offset += 1) {
			const dt = new Date(baseYear, baseMonth + offset, 1);
			const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
			const bucket: MonthlyCashflowBucket = {
				key,
				label: `${dt.getMonth() + 1}月`,
				totalCNY: 0,
				items: [],
			};
			buckets.push(bucket);
			bucketMap.set(key, bucket);
		}

		const merchantAgg = new Map<
			string,
			{ count: number; monthlyCNY: number }
		>();
		const regionAgg = new Map<string, { count: number; monthlyCNY: number }>();

		for (const srv of servers) {
			const b = parseServerBilling(
				srv,
				remaining_value.default_currency || "$",
			);
			if (!b || b.isFree || b.price <= 0) continue;

			const priceCNY = convertToCNY(b.price, b.currencyCode, rates);
			totalAssetCNY += priceCNY;

			let monthlyCost = priceCNY;
			if (b.period === "year") monthlyCost = priceCNY / 12;
			else if (b.period === "half-year") monthlyCost = priceCNY / 6;
			else if (b.period === "quarter") monthlyCost = priceCNY / 3;

			monthlyCostCNY += monthlyCost;
			if (b.period === "month") {
				monthlyOutflowCNY += priceCNY;
			}

			let remainCNY = 0;
			if (b.isNeverExpire || b.isOneTime) {
				remainCNY = priceCNY;
			} else if (b.remainingValue !== null && b.remainingValue > 0) {
				remainCNY = convertToCNY(b.remainingValue, b.currencyCode, rates);
			}
			totalRemainValCNY += remainCNY;
			details.push({ id: srv.id, name: srv.name, costCNY: monthlyCost });

			// Merchant & country ranking aggregation
			const merKey = b.merchant || "未标注商家";
			const mPrev = merchantAgg.get(merKey) ?? { count: 0, monthlyCNY: 0 };
			merchantAgg.set(merKey, {
				count: mPrev.count + 1,
				monthlyCNY: mPrev.monthlyCNY + monthlyCost,
			});

			const regKey = b.countryCode || "UN";
			const rPrev = regionAgg.get(regKey) ?? { count: 0, monthlyCNY: 0 };
			regionAgg.set(regKey, {
				count: rPrev.count + 1,
				monthlyCNY: rPrev.monthlyCNY + monthlyCost,
			});

			// Project future renewal cashflows over the next 12 months
			if (!b.isNeverExpire && !b.isOneTime && b.remainingDays !== null) {
				const todayStart = new Date();
				todayStart.setHours(0, 0, 0, 0);
				const nextExp = new Date(
					todayStart.getTime() + b.remainingDays * 86_400_000,
				);
				const stepMonths =
					b.period === "year"
						? 12
						: b.period === "half-year"
							? 6
							: b.period === "quarter"
								? 3
								: 1;
				for (let step = 0; step < 14; step += 1) {
					const occ = new Date(
						nextExp.getFullYear(),
						nextExp.getMonth() + step * stepMonths,
						nextExp.getDate(),
					);
					const occKey = `${occ.getFullYear()}-${String(occ.getMonth() + 1).padStart(2, "0")}`;
					const bucket = bucketMap.get(occKey);
					if (bucket) {
						bucket.totalCNY += priceCNY;
						bucket.items.push({
							id: srv.id,
							name: srv.name,
							amountCNY: priceCNY,
							day: occ.getDate(),
						});
					}
				}
			}
		}

		details.sort((a, b) => b.costCNY - a.costCNY);

		const toRanked = (
			m: Map<string, { count: number; monthlyCNY: number }>,
		): GroupRankItem[] => {
			return [...m.entries()]
				.map(([name, v]) => ({
					name,
					count: v.count,
					monthlyCNY: v.monthlyCNY,
					pct: monthlyCostCNY > 0 ? (v.monthlyCNY / monthlyCostCNY) * 100 : 0,
				}))
				.sort((a, b) => b.monthlyCNY - a.monthlyCNY);
		};

		const maxMonthlyCashflow = Math.max(1, ...buckets.map((bk) => bk.totalCNY));
		const yearlyCashflowTotal = buckets.reduce(
			(acc, bk) => acc + bk.totalCNY,
			0,
		);

		return {
			totalCount: servers.length,
			monthlyCostCNY,
			monthlyOutflowCNY,
			totalAssetCNY,
			totalRemainValCNY,
			details,
			buckets,
			maxMonthlyCashflow,
			yearlyCashflowTotal,
			merchantRank: toRanked(merchantAgg),
			regionRank: toRanked(regionAgg),
		};
	}, [billingSig, servers.length, rates, remaining_value.default_currency]);

	if (!open) return null;

	const targetRate = rates[currency] || 1;
	const sym = CURRENCY_SYMBOLS[currency] || currency;
	const fmt = (cnyVal: number) => `${sym}${(cnyVal * targetRate).toFixed(2)}`;
	const rateHint =
		currency === "CNY"
			? ""
			: `1 ${currency} ≈ ${(1 / targetRate).toFixed(2)} CNY`;

	const activeBucket =
		summary.buckets.find((b) => b.key === selectedMonthKey) ??
		summary.buckets[0];

	return (
		<aside
			aria-label="资产统计"
			className="fixed right-5 top-20 z-50 flex w-[340px] max-w-[calc(100vw-32px)] flex-col rounded-2xl border border-border/60 bg-card/95 text-foreground shadow-2xl backdrop-blur-md"
		>
			<div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
				<h3 className="flex items-center gap-2 text-base font-bold text-primary">
					<Wallet className="h-4 w-4" />
					资产与账单分析
				</h3>
				<button
					type="button"
					aria-label="关闭资产统计"
					onClick={onClose}
					className="rounded-md p-1 text-muted-foreground transition-transform hover:rotate-90 hover:text-foreground"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			{/* Sub-tabs */}
			<div className="flex gap-1 border-b border-border/40 bg-muted/30 px-3 py-1.5 text-[11px] font-semibold">
				<button
					type="button"
					onClick={() => setTab("overview")}
					className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 transition-colors ${
						tab === "overview"
							? "bg-card text-foreground shadow-2xs"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<Wallet className="h-3 w-3" />
					总览
				</button>
				<button
					type="button"
					onClick={() => setTab("cashflow")}
					className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 transition-colors ${
						tab === "cashflow"
							? "bg-card text-foreground shadow-2xs"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<BarChart3 className="h-3 w-3" />
					12月现金流
				</button>
				<button
					type="button"
					onClick={() => setTab("ranking")}
					className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 transition-colors ${
						tab === "ranking"
							? "bg-card text-foreground shadow-2xs"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<Building2 className="h-3 w-3" />
					商家/地区
				</button>
			</div>

			<div className="p-4">
				{tab === "overview" && (
					<>
						<div className="space-y-2 text-[13px]">
							<div className="flex justify-between">
								<span className="text-muted-foreground">服务器数量</span>
								<span className="font-bold text-primary">
									{summary.totalCount} 台
								</span>
							</div>
							<div
								className="flex justify-between"
								title="所有服务器均摊到每月的理论成本"
							>
								<span className="text-muted-foreground">每月均摊成本</span>
								<span className="font-bold text-primary">
									{fmt(summary.monthlyCostCNY)}
								</span>
							</div>
							<div
								className="flex justify-between"
								title="仅计算按月付款的服务器真实支出"
							>
								<span className="text-muted-foreground">月付固定支出</span>
								<span className="font-bold text-primary">
									{fmt(summary.monthlyOutflowCNY)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">总购入价值</span>
								<span className="font-bold text-primary">
									{fmt(summary.totalAssetCNY)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">当前剩余价值</span>
								<span className="font-bold text-primary">
									{fmt(summary.totalRemainValCNY)}
								</span>
							</div>
						</div>

						<div className="my-3 h-px bg-border/60" />

						<div className="nz-thin-scroll max-h-[190px] space-y-2 overflow-y-auto pr-1 text-xs">
							{summary.details.length > 0 ? (
								summary.details.map((item) => (
									<div
										key={item.id}
										className="flex items-center justify-between gap-2"
									>
										<span
											className="max-w-[175px] truncate text-foreground"
											title={item.name}
										>
											{item.name}
										</span>
										<span className="font-mono font-semibold text-primary">
											{fmt(item.costCNY)}/月
										</span>
									</div>
								))
							) : (
								<div className="py-3 text-center text-muted-foreground">
									{summary.totalCount > 0
										? "没有找到标有价格的服务器"
										: "等待服务器数据加载..."}
								</div>
							)}
						</div>
					</>
				)}

				{tab === "cashflow" && (
					<div className="space-y-3">
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">
								未来12个月预计续费总额
							</span>
							<span className="font-mono font-bold text-primary">
								{fmt(summary.yearlyCashflowTotal)}
							</span>
						</div>

						{/* 12-month compact bar chart */}
						<div className="grid h-[126px] grid-cols-12 items-end gap-1 rounded-lg border border-border/50 bg-muted/20 px-2 pb-2 pt-4">
							{summary.buckets.map((bk) => {
								const hPct =
									bk.totalCNY > 0
										? Math.max(
												10,
												Math.round(
													(bk.totalCNY / summary.maxMonthlyCashflow) * 100,
												),
											)
										: 4;
								const isSelected = activeBucket?.key === bk.key;
								return (
									<button
										key={bk.key}
										type="button"
										onClick={() => setSelectedMonthKey(bk.key)}
										title={`${bk.key}：${fmt(bk.totalCNY)} (${bk.items.length}台)`}
										className="group flex h-full flex-col items-center justify-end gap-1"
									>
										<div
											className={`w-full rounded-t transition-colors ${
												isSelected
													? "bg-primary"
													: bk.totalCNY > 0
														? "bg-primary/50 group-hover:bg-primary/80"
														: "bg-muted-foreground/20"
											}`}
											style={{ height: `${hPct}%` }}
										/>
										<span
											className={`text-[9px] leading-none ${
												isSelected
													? "font-bold text-primary"
													: "text-muted-foreground"
											}`}
										>
											{bk.label.replace("月", "")}
										</span>
									</button>
								);
							})}
						</div>

						{activeBucket && (
							<div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/20 p-2.5 text-xs">
								<div className="flex items-center justify-between font-semibold">
									<span>{activeBucket.key} 续费明细</span>
									<span className="font-mono text-primary">
										{fmt(activeBucket.totalCNY)}
									</span>
								</div>
								<div className="nz-thin-scroll max-h-[105px] space-y-1 overflow-y-auto pr-1">
									{activeBucket.items.length === 0 ? (
										<div className="py-2 text-center text-[11px] text-muted-foreground">
											本月无计划续费支出
										</div>
									) : (
										activeBucket.items.map((it, idx) => (
											<div
												key={`${activeBucket.key}-${it.id}-${idx}`}
												className="flex items-center justify-between gap-2 text-[11px]"
											>
												<span className="truncate text-muted-foreground">
													{it.day}日 · {it.name}
												</span>
												<span className="shrink-0 font-mono font-medium">
													{fmt(it.amountCNY)}
												</span>
											</div>
										))
									)}
								</div>
							</div>
						)}
					</div>
				)}

				{tab === "ranking" && (
					<div className="nz-thin-scroll max-h-[290px] space-y-4 overflow-y-auto pr-1 text-xs">
						<div>
							<div className="mb-2 text-[11px] font-bold text-muted-foreground">
								按商家月均消费排行
							</div>
							<div className="space-y-2">
								{summary.merchantRank.length === 0 ? (
									<div className="text-center text-muted-foreground">
										暂无数据
									</div>
								) : (
									summary.merchantRank.slice(0, 8).map((row) => (
										<div key={row.name} className="space-y-1">
											<div className="flex items-center justify-between gap-2">
												<span className="truncate font-medium">
													{row.name}{" "}
													<span className="text-[10px] text-muted-foreground">
														({row.count}台)
													</span>
												</span>
												<span className="shrink-0 font-mono text-[11px] font-semibold text-primary">
													{fmt(row.monthlyCNY)} ({row.pct.toFixed(0)}%)
												</span>
											</div>
											<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
												<div
													className="h-full rounded-full bg-primary"
													style={{ width: `${Math.min(100, row.pct)}%` }}
												/>
											</div>
										</div>
									))
								)}
							</div>
						</div>

						<div className="h-px bg-border/50" />

						<div>
							<div className="mb-2 text-[11px] font-bold text-muted-foreground">
								按地区月均消费占比
							</div>
							<div className="space-y-2">
								{summary.regionRank.slice(0, 8).map((row) => (
									<div key={row.name} className="space-y-1">
										<div className="flex items-center justify-between gap-2">
											<span className="font-medium">
												{row.name}{" "}
												<span className="text-[10px] text-muted-foreground">
													({row.count}台)
												</span>
											</span>
											<span className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
												{fmt(row.monthlyCNY)} ({row.pct.toFixed(0)}%)
											</span>
										</div>
										<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
											<div
												className="h-full rounded-full bg-emerald-500"
												style={{ width: `${Math.min(100, row.pct)}%` }}
											/>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				)}

				<div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
					<div className="flex items-center gap-2">
						<select
							aria-label="选择币种"
							value={currency}
							onChange={(e) => {
								const next = e.target.value as CurrencyCode;
								setCurrency(next);
								safeLocalStorage.setItem("fin_currency", next);
							}}
							className="rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
						>
							{CURRENCIES.map((c) => (
								<option key={c.value} value={c.value}>
									{c.label}
								</option>
							))}
						</select>
						{rateHint && (
							<span className="text-[11px] text-muted-foreground">
								{rateHint}
							</span>
						)}
					</div>

					<button
						type="button"
						onClick={() => void refreshRates()}
						title="刷新实时汇率"
						aria-label="刷新实时汇率"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<RefreshCw
							className={`h-3.5 w-3.5 transition-transform duration-500 ${spinning ? "rotate-180" : ""}`}
						/>
					</button>
				</div>
			</div>
		</aside>
	);
}
