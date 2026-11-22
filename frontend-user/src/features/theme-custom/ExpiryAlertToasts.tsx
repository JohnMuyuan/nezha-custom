import { AlertTriangle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { NezhaServer } from "@/types/nezha-api";
import { type BillingPeriodType, parseServerBilling } from "./server-billing";
import { useThemeConfig } from "./theme-config";

export interface RenewalServerItem {
	id: number;
	name: string;
	remainDays: number;
	year: number;
	month: number; // 0-11
	date: number;
	cycle: BillingPeriodType | "none";
}

export function buildRenewalItems(servers: NezhaServer[]): RenewalServerItem[] {
	const items: RenewalServerItem[] = [];
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	for (const srv of servers) {
		const b = parseServerBilling(srv);
		if (!b || b.isNeverExpire || b.isOneTime || b.remainingDays === null) {
			continue;
		}
		const exp = new Date(today.getTime() + b.remainingDays * 86_400_000);
		items.push({
			id: srv.id,
			name: srv.name,
			remainDays: b.remainingDays,
			year: exp.getFullYear(),
			month: exp.getMonth(),
			date: exp.getDate(),
			cycle: b.period,
		});
	}
	return items;
}

export function ExpiryAlertToasts({
	servers,
	onAllDismissed,
}: {
	servers: NezhaServer[];
	onAllDismissed?: () => void;
}) {
	const { renewal_calendar } = useThemeConfig();
	const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
	const [autoHidden, setAutoHidden] = useState(false);

	const billingSig = servers
		.map((s) => `${s.id}:${s.name}:${s.public_note ?? ""}`)
		.join("|");

	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by billingSig so 1s WS ticks skip re-parsing
	const urgentServers = useMemo(() => {
		if (!renewal_calendar.enable_expiry_alerts || !billingSig) return [];
		const items = buildRenewalItems(servers);
		return items
			.filter((s) => s.remainDays <= renewal_calendar.urgent_days)
			.sort((a, b) => a.remainDays - b.remainDays)
			.slice(0, Math.max(1, renewal_calendar.max_alert_count || 3));
	}, [
		billingSig,
		renewal_calendar.enable_expiry_alerts,
		renewal_calendar.urgent_days,
		renewal_calendar.max_alert_count,
	]);

	useEffect(() => {
		if (urgentServers.length === 0) return;
		const timer = setTimeout(() => {
			setAutoHidden(true);
			onAllDismissed?.();
		}, 8500);
		return () => clearTimeout(timer);
	}, [urgentServers.length, onAllDismissed]);

	if (
		!renewal_calendar.enable_expiry_alerts ||
		autoHidden ||
		urgentServers.length === 0
	) {
		return null;
	}

	const visible = urgentServers.filter((s) => !dismissedIds.has(s.id));
	if (visible.length === 0) {
		return null;
	}

	return (
		<div
			role="status"
			aria-live="polite"
			className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-sm:inset-x-3 max-sm:bottom-20"
		>
			{visible.map((srv) => {
				const dateStr = `${srv.year}年${srv.month + 1}月${srv.date}日`;
				return (
					<div
						key={srv.id}
						className="relative w-[310px] max-w-full rounded-lg border border-border/70 border-l-4 border-l-red-500 bg-card/95 px-4 py-3 shadow-xl backdrop-blur-md"
					>
						<button
							type="button"
							aria-label={`关闭 ${srv.name} 到期提醒`}
							onClick={() => {
								const next = new Set(dismissedIds);
								next.add(srv.id);
								setDismissedIds(next);
								if (urgentServers.every((u) => next.has(u.id))) {
									onAllDismissed?.();
								}
							}}
							className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
						>
							<X className="h-4 w-4" />
						</button>
						<div className="mb-1 flex items-center gap-1.5 text-xs font-extrabold text-red-500">
							<AlertTriangle className="h-4 w-4" />
							资产续费预警
						</div>
						<div className="pr-5 text-xs leading-relaxed text-foreground">
							<b className="break-all">{srv.name}</b>
							<br />
							{srv.remainDays < 0 ? (
								<b className="text-muted-foreground">已过期</b>
							) : srv.remainDays === 0 ? (
								<b className="text-red-500">将于今天</b>
							) : (
								<>
									将于 <b>{srv.remainDays}天后</b>
								</>
							)}
							（{dateStr}）到期。
						</div>
					</div>
				);
			})}
		</div>
	);
}
