import { RefreshCw, Wallet, X } from "lucide-react";
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
		.map((s) => `${s.id}:${s.name}:${s.public_note ?? ""}`)
		.join("|");

	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by billingSig so 1s WS ticks skip re-parsing
	const summary = useMemo(() => {
		let monthlyCostCNY = 0;
		let monthlyOutflowCNY = 0;
		let totalAssetCNY = 0;
		let totalRemainValCNY = 0;
		const details: Array<{ id: number; name: string; costCNY: number }> = [];

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
		}

		details.sort((a, b) => b.costCNY - a.costCNY);
		return {
			totalCount: servers.length,
			monthlyCostCNY,
			monthlyOutflowCNY,
			totalAssetCNY,
			totalRemainValCNY,
			details,
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

	return (
		<aside
			aria-label="资产统计"
			className="fixed right-5 top-20 z-50 flex w-[295px] max-w-[calc(100vw-32px)] flex-col rounded-2xl border border-border/60 bg-card/90 text-foreground shadow-2xl backdrop-blur-xl"
		>
			<div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
				<h3 className="flex items-center gap-2 text-base font-bold text-primary">
					<Wallet className="h-4 w-4" />
					资产统计
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

			<div className="p-4">
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
						<span className="text-muted-foreground">每月成本</span>
						<span className="font-bold text-primary">
							{fmt(summary.monthlyCostCNY)}
						</span>
					</div>
					<div
						className="flex justify-between"
						title="仅计算按月付款的服务器真实支出"
					>
						<span className="text-muted-foreground">每月支出</span>
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

				<div className="nz-thin-scroll max-h-[200px] space-y-2 overflow-y-auto pr-1 text-xs">
					{summary.details.length > 0 ? (
						summary.details.map((item) => (
							<div
								key={item.id}
								className="flex items-center justify-between gap-2"
							>
								<span
									className="max-w-[145px] truncate text-foreground"
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
