import { useQuery } from "@tanstack/react-query";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { NezhaServer } from "@/types/nezha-api";
import {
	fetchAllInspections,
	type InspectionSummary,
	isUnlockedStatus,
} from "./inspection-api";
import {
	convertToCNY,
	DEFAULT_EXCHANGE_RATES,
	parseServerBilling,
} from "./server-billing";
import { useThemeConfig } from "./theme-config";

export type ExtraSortMode =
	| "none"
	| "expiry_asc"
	| "remain_val_desc"
	| "price_asc"
	| "price_desc";

export interface ServerExtraFilterState {
	query: string;
	unlockPlatforms: string[];
	expiring30d: boolean;
	extraSort: ExtraSortMode;
}

export const INITIAL_EXTRA_FILTER: ServerExtraFilterState = {
	query: "",
	unlockPlatforms: [],
	expiring30d: false,
	extraSort: "none",
};

const QUICK_UNLOCK_FILTERS: Array<{ id: string; label: string }> = [
	{ id: "netflix", label: "Netflix" },
	{ id: "disney", label: "Disney+" },
	{ id: "chatgpt", label: "ChatGPT" },
	{ id: "claude", label: "Claude" },
	{ id: "gemini", label: "Gemini" },
];

export function useInspectionSummaries(enabled: boolean) {
	return useQuery({
		queryKey: ["server-inspections"],
		queryFn: fetchAllInspections,
		enabled,
		staleTime: 60_000,
		retry: false,
	});
}

export function applyExtraServerFilters(
	servers: NezhaServer[],
	filter: ServerExtraFilterState,
	inspections?: Record<string, InspectionSummary>,
): NezhaServer[] {
	const hasQuery = filter.query.trim().length > 0;
	const hasUnlock = filter.unlockPlatforms.length > 0;
	const hasExpiring = filter.expiring30d;
	const hasSort = filter.extraSort !== "none";

	if (!hasQuery && !hasUnlock && !hasExpiring && !hasSort) {
		return servers;
	}

	const q = filter.query.trim().toLowerCase();

	// Precompute lightweight billing map only for the filtered list
	const billingCache = new Map<number, ReturnType<typeof parseServerBilling>>();
	const getBilling = (srv: NezhaServer) => {
		if (!billingCache.has(srv.id)) {
			billingCache.set(srv.id, parseServerBilling(srv));
		}
		return billingCache.get(srv.id) ?? null;
	};

	const matched = servers.filter((srv) => {
		const insp = inspections?.[String(srv.id)];

		if (hasUnlock) {
			for (const plat of filter.unlockPlatforms) {
				if (!isUnlockedStatus(insp?.unlocked?.[plat])) {
					return false;
				}
			}
		}

		if (hasExpiring) {
			const b = getBilling(srv);
			if (
				!b ||
				b.isNeverExpire ||
				b.isOneTime ||
				b.remainingDays === null ||
				b.remainingDays > 30
			) {
				return false;
			}
		}

		if (hasQuery) {
			const b = getBilling(srv);
			const routeText = insp?.routes
				? Object.values(insp.routes).join(" ")
				: "";
			const hay = [
				srv.name,
				srv.country_code,
				b?.merchant ?? "",
				b?.routing ?? "",
				routeText,
			]
				.join(" ")
				.toLowerCase();
			if (!hay.includes(q)) return false;
		}

		return true;
	});

	if (!hasSort) return matched;

	const monthlyPriceCNY = (srv: NezhaServer) => {
		const b = getBilling(srv);
		if (!b || b.isFree || b.price <= 0) return Number.POSITIVE_INFINITY;
		const total = convertToCNY(b.price, b.currencyCode, DEFAULT_EXCHANGE_RATES);
		if (b.period === "year") return total / 12;
		if (b.period === "half-year") return total / 6;
		if (b.period === "quarter") return total / 3;
		return total;
	};

	const remainValCNY = (srv: NezhaServer) => {
		const b = getBilling(srv);
		if (!b || b.remainingValue === null || b.remainingValue <= 0) return -1;
		return convertToCNY(
			b.remainingValue,
			b.currencyCode,
			DEFAULT_EXCHANGE_RATES,
		);
	};

	const remainDays = (srv: NezhaServer) => {
		const b = getBilling(srv);
		if (!b || b.isNeverExpire || b.isOneTime || b.remainingDays === null) {
			return Number.POSITIVE_INFINITY;
		}
		return b.remainingDays;
	};

	return [...matched].sort((a, b) => {
		switch (filter.extraSort) {
			case "expiry_asc":
				return remainDays(a) - remainDays(b);
			case "remain_val_desc":
				return remainValCNY(b) - remainValCNY(a);
			case "price_asc":
				return monthlyPriceCNY(a) - monthlyPriceCNY(b);
			case "price_desc": {
				const pa = monthlyPriceCNY(a);
				const pb = monthlyPriceCNY(b);
				const safeA = Number.isFinite(pa) ? pa : -1;
				const safeB = Number.isFinite(pb) ? pb : -1;
				return safeB - safeA;
			}
			default:
				return 0;
		}
	});
}

export function ServerFilterExtras({
	value,
	onChange,
	totalBefore,
	totalAfter,
	customBackgroundImage,
}: {
	value: ServerExtraFilterState;
	onChange: (next: ServerExtraFilterState) => void;
	totalBefore: number;
	totalAfter: number;
	customBackgroundImage?: string;
}) {
	const { filter_bar, media_unlock } = useThemeConfig();
	const searchId = useId();
	const sortId = useId();

	const hasActiveFilter = useMemo(
		() =>
			value.query.trim().length > 0 ||
			value.unlockPlatforms.length > 0 ||
			value.expiring30d ||
			value.extraSort !== "none",
		[value],
	);

	if (!filter_bar.enabled) return null;

	const togglePlatform = (plat: string) => {
		const exists = value.unlockPlatforms.includes(plat);
		const next = exists
			? value.unlockPlatforms.filter((p) => p !== plat)
			: [...value.unlockPlatforms, plat];
		onChange({ ...value, unlockPlatforms: next });
	};

	return (
		<search
			aria-label="节点多维筛选与检索"
			className={cn(
				"mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-stone-200/80 bg-white/90 px-3 py-2 text-xs shadow-2xs dark:border-stone-800 dark:bg-stone-900/85",
				customBackgroundImage &&
					"bg-white/75 backdrop-blur-sm dark:bg-stone-900/75",
			)}
		>
			<div className="relative flex min-w-[160px] flex-1 items-center sm:max-w-[230px]">
				<Search
					className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground"
					aria-hidden="true"
				/>
				<label htmlFor={searchId} className="sr-only">
					搜索服务器名称、商家、地区或线路
				</label>
				<input
					id={searchId}
					type="search"
					value={value.query}
					onChange={(e) => onChange({ ...value, query: e.target.value })}
					placeholder="搜名称 / 商家 / 地区 / 线路..."
					autoCorrect="off"
					autoCapitalize="none"
					spellCheck={false}
					className="h-7 w-full rounded-full border border-border/70 bg-background/80 pl-8 pr-3 text-xs text-foreground outline-none transition-colors focus-visible:border-primary"
				/>
			</div>

			{media_unlock.enabled && (
				<div className="flex flex-wrap items-center gap-1.5">
					{QUICK_UNLOCK_FILTERS.map((item) => {
						const active = value.unlockPlatforms.includes(item.id);
						return (
							<button
								key={item.id}
								type="button"
								aria-pressed={active}
								onClick={() => togglePlatform(item.id)}
								className={cn(
									"h-7 rounded-full border px-2.5 text-[11px] font-semibold transition-colors",
									active
										? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
										: "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground",
								)}
							>
								{item.label}
							</button>
						);
					})}
				</div>
			)}

			<button
				type="button"
				aria-pressed={value.expiring30d}
				onClick={() => onChange({ ...value, expiring30d: !value.expiring30d })}
				className={cn(
					"h-7 rounded-full border px-2.5 text-[11px] font-semibold transition-colors",
					value.expiring30d
						? "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300"
						: "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground",
				)}
			>
				30天内到期
			</button>

			<div className="ml-auto flex items-center gap-1.5">
				<SlidersHorizontal
					className="h-3.5 w-3.5 text-muted-foreground"
					aria-hidden="true"
				/>
				<label htmlFor={sortId} className="sr-only">
					账单与到期排序
				</label>
				<select
					id={sortId}
					value={value.extraSort}
					onChange={(e) =>
						onChange({
							...value,
							extraSort: e.target.value as ExtraSortMode,
						})
					}
					className="h-7 rounded-full border border-border/70 bg-background/80 px-2.5 text-[11px] font-medium text-foreground outline-none focus-visible:border-primary"
				>
					<option value="none">账单排序: 默认</option>
					<option value="expiry_asc">到期最近优先</option>
					<option value="remain_val_desc">剩余价值高→低</option>
					<option value="price_asc">月均价格低→高</option>
					<option value="price_desc">月均价格高→低</option>
				</select>

				{hasActiveFilter && (
					<button
						type="button"
						onClick={() => onChange(INITIAL_EXTRA_FILTER)}
						className="inline-flex h-7 items-center gap-1 rounded-full border border-border/70 bg-muted/60 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
						title="清除筛选"
					>
						<RotateCcw className="h-3 w-3" />
						<span>
							{totalAfter}/{totalBefore}
						</span>
					</button>
				)}
			</div>
		</search>
	);
}
