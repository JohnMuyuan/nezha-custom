import {
	AlertTriangle,
	Calendar,
	ChevronLeft,
	ChevronRight,
	X,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { NezhaServer } from "@/types/nezha-api";
import { CustomModalDialog } from "./CustomModalDialog";
import { type BillingPeriodType, parseServerBilling } from "./server-billing";
import { useThemeConfig } from "./theme-config";

type CalendarView = "year" | "month" | "week";

interface RenewalServerItem {
	id: number;
	name: string;
	remainDays: number;
	year: number;
	month: number; // 0-11
	date: number;
	cycle: BillingPeriodType | "none";
}

interface CalendarEvent extends RenewalServerItem {
	eventDate: Date;
	isUrgent: boolean;
	isProjected: boolean;
}

function buildRenewalItems(servers: NezhaServer[]): RenewalServerItem[] {
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

function projectEvents(
	items: RenewalServerItem[],
	urgentDays: number,
): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	const todayMs = new Date().setHours(0, 0, 0, 0);

	for (const srv of items) {
		const baseDate = new Date(srv.year, srv.month, srv.date);
		events.push({
			...srv,
			eventDate: baseDate,
			isUrgent: srv.remainDays <= urgentDays && srv.remainDays >= 0,
			isProjected: false,
		});

		if (srv.cycle !== "none") {
			const loops =
				srv.cycle === "month"
					? 24
					: srv.cycle === "quarter"
						? 8
						: srv.cycle === "half-year"
							? 4
							: 2;
			for (let i = 1; i <= loops; i += 1) {
				const nextDate = new Date(srv.year, srv.month, srv.date);
				if (srv.cycle === "month") nextDate.setMonth(nextDate.getMonth() + i);
				else if (srv.cycle === "quarter")
					nextDate.setMonth(nextDate.getMonth() + i * 3);
				else if (srv.cycle === "half-year")
					nextDate.setMonth(nextDate.getMonth() + i * 6);
				else if (srv.cycle === "year")
					nextDate.setFullYear(nextDate.getFullYear() + i);

				const diff = Math.ceil((nextDate.getTime() - todayMs) / 86_400_000);
				events.push({
					...srv,
					eventDate: nextDate,
					isUrgent: diff <= urgentDays && diff >= 0,
					isProjected: true,
				});
			}
		}
	}
	return events;
}

export function RenewalCalendarModal({
	open,
	onClose,
	servers,
}: {
	open: boolean;
	onClose: () => void;
	servers: NezhaServer[];
}) {
	const { renewal_calendar } = useThemeConfig();
	const titleId = useId();
	const [view, setView] = useState<CalendarView>("month");
	const [cursor, setCursor] = useState(() => new Date());

	const items = useMemo(() => buildRenewalItems(servers), [servers]);
	const allEvents = useMemo(
		() => projectEvents(items, renewal_calendar.urgent_days),
		[items, renewal_calendar.urgent_days],
	);

	const realToday = new Date();
	const y = cursor.getFullYear();
	const m = cursor.getMonth();

	const handlePrev = () => {
		const next = new Date(cursor);
		if (view === "year") next.setFullYear(y - 1);
		else if (view === "month") next.setMonth(m - 1);
		else next.setDate(next.getDate() - 7);
		setCursor(next);
	};

	const handleNext = () => {
		const next = new Date(cursor);
		if (view === "year") next.setFullYear(y + 1);
		else if (view === "month") next.setMonth(m + 1);
		else next.setDate(next.getDate() + 7);
		setCursor(next);
	};

	const daysToRender = useMemo(() => {
		if (view === "year") return [];
		const list: Array<{ y: number; m: number; d: number; isCurrent: boolean }> =
			[];
		if (view === "month") {
			const firstDow = new Date(y, m, 1).getDay();
			const offset = firstDow === 0 ? 6 : firstDow - 1;
			const daysInM = new Date(y, m + 1, 0).getDate();
			const daysPrev = new Date(y, m, 0).getDate();
			for (let i = offset - 1; i >= 0; i -= 1) {
				list.push({
					y: m === 0 ? y - 1 : y,
					m: m === 0 ? 11 : m - 1,
					d: daysPrev - i,
					isCurrent: false,
				});
			}
			for (let d = 1; d <= daysInM; d += 1) {
				list.push({ y, m, d, isCurrent: true });
			}
			const rem = 42 - list.length;
			for (let d = 1; d <= rem; d += 1) {
				list.push({
					y: m === 11 ? y + 1 : y,
					m: m === 11 ? 0 : m + 1,
					d,
					isCurrent: false,
				});
			}
		} else {
			const dow = cursor.getDay() === 0 ? 6 : cursor.getDay() - 1;
			const start = new Date(cursor);
			start.setDate(cursor.getDate() - dow);
			for (let i = 0; i < 7; i += 1) {
				const t = new Date(start);
				t.setDate(start.getDate() + i);
				list.push({
					y: t.getFullYear(),
					m: t.getMonth(),
					d: t.getDate(),
					isCurrent: true,
				});
			}
		}
		return list;
	}, [view, y, m, cursor]);

	let headerLabel = `${y}年 ${m + 1}月`;
	if (view === "year") headerLabel = `${y} 年`;
	else if (view === "week" && daysToRender.length === 7) {
		const s = daysToRender[0];
		const e = daysToRender[6];
		headerLabel = `${s.m + 1}/${s.d} - ${e.m + 1}/${e.d}`;
	}

	return (
		<CustomModalDialog
			open={open}
			onClose={onClose}
			labelledBy={titleId}
			className="w-[92vw] max-w-[820px]"
		>
			<div className="flex items-center justify-between border-b border-border/50 bg-muted/20 px-6 py-4">
				<h2
					id={titleId}
					className="flex items-center gap-2 text-base font-bold"
				>
					<Calendar className="h-5 w-5 text-blue-500" />
					资产续费推演表
				</h2>
				<button
					type="button"
					aria-label="关闭续费日历"
					onClick={onClose}
					className="rounded-md p-1 text-muted-foreground transition-transform hover:rotate-90 hover:text-foreground"
				>
					<X className="h-5 w-5" />
				</button>
			</div>

			<div className="nz-thin-scroll flex-1 overflow-y-auto p-5">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={handlePrev}
							aria-label="上一周期"
							className="rounded-md border border-border bg-muted/40 p-1.5 hover:bg-blue-500 hover:text-white"
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<div className="min-w-[130px] text-center text-base font-extrabold text-blue-500">
							{headerLabel}
						</div>
						<button
							type="button"
							onClick={handleNext}
							aria-label="下一周期"
							className="rounded-md border border-border bg-muted/40 p-1.5 hover:bg-blue-500 hover:text-white"
						>
							<ChevronRight className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => setCursor(new Date())}
							className="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold hover:bg-blue-500 hover:text-white"
						>
							回到今天
						</button>
					</div>

					<div className="flex rounded-md border border-border bg-muted/40 p-0.5 text-xs">
						{(
							[
								["year", "年视图"],
								["month", "月视图"],
								["week", "周视图"],
							] as const
						).map(([key, label]) => (
							<button
								key={key}
								type="button"
								onClick={() => setView(key)}
								className={`rounded px-3 py-1 font-semibold transition-colors ${
									view === key
										? "bg-card text-foreground shadow-xs"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{label}
							</button>
						))}
					</div>
				</div>

				{view === "year" ? (
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
						{Array.from({ length: 12 }, (_, monthIdx) => {
							const daysInM = new Date(y, monthIdx + 1, 0).getDate();
							const firstDow = new Date(y, monthIdx, 1).getDay();
							const offset = firstDow === 0 ? 6 : firstDow - 1;
							return (
								<button
									key={monthIdx}
									type="button"
									onClick={() => {
										const next = new Date(cursor);
										next.setMonth(monthIdx);
										setCursor(next);
										setView("month");
									}}
									className="rounded-lg border border-border/70 bg-card/80 p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-blue-500 hover:shadow-md"
								>
									<div className="mb-1.5 text-center text-xs font-bold">
										{monthIdx + 1}月
									</div>
									<div className="mb-1 grid grid-cols-7 text-center text-[10px] text-muted-foreground">
										{["一", "二", "三", "四", "五", "六", "日"].map((w) => (
											<span key={w}>{w}</span>
										))}
									</div>
									<div className="grid grid-cols-7 gap-0.5">
										{Array.from({ length: offset }, (_, j) => (
											<span key={`e-${j}`} />
										))}
										{Array.from({ length: daysInM }, (_, idx) => {
											const d = idx + 1;
											const isToday =
												realToday.getFullYear() === y &&
												realToday.getMonth() === monthIdx &&
												realToday.getDate() === d;
											const dayEvents = allEvents.filter(
												(e) =>
													e.eventDate.getFullYear() === y &&
													e.eventDate.getMonth() === monthIdx &&
													e.eventDate.getDate() === d,
											);
											const urgentCount = dayEvents.filter(
												(e) => e.isUrgent,
											).length;
											const normalCount = dayEvents.length - urgentCount;
											let cellStyle: React.CSSProperties | undefined;
											if (urgentCount > 0) {
												const alpha = Math.min(0.9, 0.2 + urgentCount * 0.35);
												cellStyle = {
													backgroundColor: `rgba(239, 68, 68, ${alpha})`,
													color: alpha > 0.5 ? "#fff" : "#ef4444",
												};
											} else if (normalCount > 0) {
												const alpha = Math.min(0.9, 0.2 + normalCount * 0.35);
												cellStyle = {
													backgroundColor: `rgba(59, 130, 246, ${alpha})`,
													color: alpha > 0.5 ? "#fff" : "#3b82f6",
												};
											}
											return (
												<span
													key={d}
													style={cellStyle}
													className={`flex aspect-square items-center justify-center rounded-full text-[10px] ${
														isToday ? "ring-2 ring-blue-500 font-bold" : ""
													}`}
												>
													{d}
												</span>
											);
										})}
									</div>
								</button>
							);
						})}
					</div>
				) : (
					<div className="overflow-hidden rounded-lg border border-border/70">
						<div className="grid grid-cols-7 border-b border-border/70 bg-muted/30 text-center text-xs font-bold text-muted-foreground">
							{["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map(
								(day, idx) => (
									<div
										key={day}
										className={`py-2 ${idx === 6 ? "text-red-500" : ""}`}
									>
										{day}
									</div>
								),
							)}
						</div>
						<div className="grid grid-cols-7 gap-px bg-border/60">
							{daysToRender.map((cell) => {
								const isToday =
									realToday.getFullYear() === cell.y &&
									realToday.getMonth() === cell.m &&
									realToday.getDate() === cell.d;
								const dayEvents = allEvents.filter(
									(e) =>
										e.eventDate.getFullYear() === cell.y &&
										e.eventDate.getMonth() === cell.m &&
										e.eventDate.getDate() === cell.d,
								);
								return (
									<div
										key={`${cell.y}-${cell.m}-${cell.d}`}
										className={`flex flex-col gap-1 p-1.5 ${
											view === "week" ? "min-h-[170px]" : "min-h-[78px]"
										} ${
											isToday
												? "bg-blue-500/10"
												: cell.isCurrent
													? "bg-card"
													: "bg-card/40 opacity-45"
										}`}
									>
										<div
											className={`self-end font-mono text-xs font-bold ${
												isToday
													? "flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-white"
													: "text-muted-foreground"
											}`}
										>
											{view === "week" && cell.d === 1
												? `${cell.m + 1}月1日`
												: cell.d}
										</div>
										{dayEvents.map((ev, idx) => (
											<div
												key={`${ev.id}-${idx}`}
												title={`${ev.name}${ev.isProjected ? " (循环预估)" : ""}`}
												className={`rounded border border-l-[3px] px-1 py-0.5 text-[10px] font-semibold leading-tight break-all ${
													ev.isUrgent
														? "border-red-500 bg-red-500/10 text-red-500"
														: ev.isProjected
															? "border-dashed border-blue-500/70 text-foreground/85"
															: "border-blue-500 text-foreground"
												}`}
											>
												{ev.name}
												{ev.isProjected ? " 🔄" : ""}
											</div>
										))}
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</CustomModalDialog>
	);
}

export function ExpiryAlertToasts({ servers }: { servers: NezhaServer[] }) {
	const { renewal_calendar } = useThemeConfig();
	const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
	const [autoHidden, setAutoHidden] = useState(false);

	const urgentServers = useMemo(() => {
		if (!renewal_calendar.enable_expiry_alerts) return [];
		const items = buildRenewalItems(servers);
		return items
			.filter((s) => s.remainDays <= renewal_calendar.urgent_days)
			.sort((a, b) => a.remainDays - b.remainDays)
			.slice(0, Math.max(1, renewal_calendar.max_alert_count || 3));
	}, [
		servers,
		renewal_calendar.enable_expiry_alerts,
		renewal_calendar.urgent_days,
		renewal_calendar.max_alert_count,
	]);

	useEffect(() => {
		if (urgentServers.length === 0) return;
		const timer = setTimeout(() => setAutoHidden(true), 8500);
		return () => clearTimeout(timer);
	}, [urgentServers.length]);

	if (
		!renewal_calendar.enable_expiry_alerts ||
		autoHidden ||
		urgentServers.length === 0
	) {
		return null;
	}

	const visible = urgentServers.filter((s) => !dismissedIds.has(s.id));
	if (visible.length === 0) return null;

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
							onClick={() =>
								setDismissedIds((prev) => new Set(prev).add(srv.id))
							}
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
