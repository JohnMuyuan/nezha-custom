import type {
	LatencyCellStats,
	LatencyOverviewServer,
} from "@/types/nezha-api";

export type StabilityTier = "rock" | "good" | "shaky" | "unstable" | "none";

export interface StabilityMeta {
	tier: StabilityTier;
	label: string;
	shortLabel: string;
	symbol: string;
	badgeClass: string;
	textClass: string;
}

export function getStabilityMeta(
	score: number | null | undefined,
	hasData = true,
): StabilityMeta {
	if (!hasData || score == null || Number.isNaN(score)) {
		return {
			tier: "none",
			label: "暂无数据",
			shortLabel: "无数据",
			symbol: "—",
			badgeClass:
				"border-border/70 bg-muted/60 text-muted-foreground",
			textClass: "text-muted-foreground",
		};
	}
	if (score >= 90) {
		return {
			tier: "rock",
			label: "极稳",
			shortLabel: "极稳",
			symbol: "✓",
			badgeClass:
				"border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/18 dark:text-emerald-300",
			textClass: "text-emerald-700 dark:text-emerald-400",
		};
	}
	if (score >= 75) {
		return {
			tier: "good",
			label: "稳定",
			shortLabel: "稳定",
			symbol: "●",
			badgeClass:
				"border-sky-500/35 bg-sky-500/12 text-sky-700 dark:border-sky-400/35 dark:bg-sky-500/18 dark:text-sky-300",
			textClass: "text-sky-700 dark:text-sky-400",
		};
	}
	if (score >= 55) {
		return {
			tier: "shaky",
			label: "有波动",
			shortLabel: "波动",
			symbol: "▲",
			badgeClass:
				"border-amber-500/40 bg-amber-500/15 text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-amber-300",
			textClass: "text-amber-700 dark:text-amber-400",
		};
	}
	return {
		tier: "unstable",
		label: "不稳定",
		shortLabel: "不稳",
		symbol: "✕",
		badgeClass:
			"border-rose-500/45 bg-rose-500/15 text-rose-800 dark:border-rose-400/45 dark:bg-rose-500/20 dark:text-rose-300",
		textClass: "text-rose-700 dark:text-rose-400",
	};
}

export interface CellHeatStyle {
	pillClass: string;
	delayClass: string;
	strokeColor: string;
	isAlert: boolean;
}

export function getCellHeatStyle(cell: LatencyCellStats | undefined): CellHeatStyle {
	if (!cell || (cell.avg_ms == null && cell.loss_percent === 0)) {
		return {
			pillClass: "border-border/45 bg-muted/30 text-muted-foreground",
			delayClass: "text-muted-foreground",
			strokeColor: "#94a3b8",
			isAlert: false,
		};
	}

	// Highlight instability / heavy packet loss strongly even if average ms is low!
	if (cell.avg_ms == null || cell.loss_percent >= 3 || cell.stability_score < 55) {
		return {
			pillClass:
				"border-rose-500/40 bg-rose-500/12 dark:border-rose-400/40 dark:bg-rose-500/16",
			delayClass: "text-rose-700 dark:text-rose-300",
			strokeColor: "#e11d48",
			isAlert: true,
		};
	}
	if (cell.loss_percent >= 0.5 || cell.stability_score < 75 || cell.avg_ms >= 240) {
		return {
			pillClass:
				"border-amber-500/40 bg-amber-500/12 dark:border-amber-400/35 dark:bg-amber-500/16",
			delayClass: "text-amber-800 dark:text-amber-300",
			strokeColor: "#d97706",
			isAlert: cell.loss_percent >= 0.5 || cell.stability_score < 75,
		};
	}
	if (cell.avg_ms < 80) {
		return {
			pillClass:
				"border-emerald-500/35 bg-emerald-500/10 dark:border-emerald-400/30 dark:bg-emerald-500/14",
			delayClass: "text-emerald-700 dark:text-emerald-300",
			strokeColor: "#059669",
			isAlert: false,
		};
	}
	if (cell.avg_ms < 160) {
		return {
			pillClass:
				"border-sky-500/30 bg-sky-500/10 dark:border-sky-400/30 dark:bg-sky-500/14",
			delayClass: "text-sky-700 dark:text-sky-300",
			strokeColor: "#0284c7",
			isAlert: false,
		};
	}
	return {
		pillClass:
			"border-amber-500/30 bg-amber-500/8 dark:border-amber-400/25 dark:bg-amber-500/12",
		delayClass: "text-amber-800 dark:text-amber-300",
		strokeColor: "#d97706",
		isAlert: false,
	};
}

export type SortDirection = "ascending" | "descending";
export type LatencySortKey =
	| "name"
	| "avg"
	| "stability"
	| "jitter"
	| "loss"
	| `monitor:${number}`;

const nameCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

function extractSortNumber(
	server: LatencyOverviewServer,
	key: LatencySortKey,
): number | null {
	switch (key) {
		case "avg":
			return server.avg_ms;
		case "stability":
			return server.stability_score;
		case "jitter":
			return server.jitter_ms;
		case "loss":
			return server.monitor_count > 0 ? server.loss_percent : null;
		case "name":
			return null;
		default: {
			if (key.startsWith("monitor:")) {
				const monId = key.slice("monitor:".length);
				const cell = server.cells?.[monId];
				return cell?.avg_ms ?? null;
			}
			return null;
		}
	}
}

export function sortLatencyServers(
	servers: readonly LatencyOverviewServer[],
	sortKey: LatencySortKey,
	direction: SortDirection,
): LatencyOverviewServer[] {
	const factor = direction === "ascending" ? 1 : -1;
	return [...servers].sort((a, b) => {
		if (sortKey === "name") {
			return factor * nameCollator.compare(a.name, b.name);
		}
		const av = extractSortNumber(a, sortKey);
		const bv = extractSortNumber(b, sortKey);
		// Always keep rows without data at the bottom regardless of sort direction
		if (av == null && bv == null) {
			return nameCollator.compare(a.name, b.name);
		}
		if (av == null) return 1;
		if (bv == null) return -1;
		if (av !== bv) {
			return factor * (av - bv);
		}
		return nameCollator.compare(a.name, b.name);
	});
}

export interface FleetHighlights {
	fastest: LatencyOverviewServer | null;
	mostStable: LatencyOverviewServer | null;
	mostUnstable: LatencyOverviewServer | null;
	fleetAvgMs: number | null;
	fleetAvgJitterMs: number | null;
	monitoredCount: number;
	unstableCount: number;
}

export function computeFleetHighlights(
	servers: readonly LatencyOverviewServer[],
): FleetHighlights {
	const withLatency = servers.filter((s) => s.avg_ms != null && s.monitor_count > 0);
	const withStability = servers.filter(
		(s) => s.stability_score != null && s.monitor_count > 0,
	);
	const withJitter = servers.filter((s) => s.jitter_ms != null && s.monitor_count > 0);

	const fastest =
		withLatency.length > 0
			? withLatency.reduce((best, cur) =>
					(cur.avg_ms ?? Infinity) < (best.avg_ms ?? Infinity) ? cur : best,
				)
			: null;

	const mostStable =
		withStability.length > 0
			? withStability.reduce((best, cur) => {
					const cs = cur.stability_score ?? -1;
					const bs = best.stability_score ?? -1;
					if (cs !== bs) return cs > bs ? cur : best;
					return (cur.avg_ms ?? Infinity) < (best.avg_ms ?? Infinity)
						? cur
						: best;
				})
			: null;

	const mostUnstable =
		withStability.length > 0
			? withStability.reduce((worst, cur) => {
					const cs = cur.stability_score ?? 101;
					const ws = worst.stability_score ?? 101;
					if (cs !== ws) return cs < ws ? cur : worst;
					return cur.loss_percent > worst.loss_percent ? cur : worst;
				})
			: null;

	const fleetAvgMs =
		withLatency.length > 0
			? withLatency.reduce((acc, s) => acc + (s.avg_ms ?? 0), 0) /
				withLatency.length
			: null;

	const fleetAvgJitterMs =
		withJitter.length > 0
			? withJitter.reduce((acc, s) => acc + (s.jitter_ms ?? 0), 0) /
				withJitter.length
			: null;

	const unstableCount = withStability.filter(
		(s) => (s.stability_score ?? 100) < 75 || s.loss_percent >= 1,
	).length;

	return {
		fastest,
		mostStable,
		mostUnstable,
		fleetAvgMs,
		fleetAvgJitterMs,
		monitoredCount: withStability.length,
		unstableCount,
	};
}

export function formatMs(val: number | null | undefined, digits = 1): string {
	if (val == null || Number.isNaN(val)) return "—";
	return `${val.toFixed(digits)}ms`;
}
