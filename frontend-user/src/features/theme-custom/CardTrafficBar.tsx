import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { fetchService } from "@/lib/nezha-api";
import {
	calculateRemainingDaysUntil,
	extractCycleTrafficMap,
	formatFileSizeParts,
	formatShortDate,
	getTrafficGradientColor,
} from "./server-billing";
import { useThemeConfig } from "./theme-config";

export function CardTrafficBar({ serverId }: { serverId: number }) {
	const { traffic_bar } = useThemeConfig();

	const { data: serviceData } = useQuery({
		queryKey: ["service"],
		queryFn: () => fetchService(),
		refetchInterval: Math.max(5000, traffic_bar.interval_ms || 60000),
		retry: false,
		enabled: traffic_bar.enabled,
	});

	const statsMap = useMemo(
		() => extractCycleTrafficMap(serviceData?.data?.cycle_transfer_stats),
		[serviceData?.data?.cycle_transfer_stats],
	);

	const serverStat = statsMap.get(serverId);

	const [slideIndex, setSlideIndex] = useState(0);
	const [fading, setFading] = useState(false);

	useEffect(() => {
		if (!traffic_bar.enabled || !serverStat) return;
		const interval = traffic_bar.toggle_interval_ms;
		if (!interval || interval <= 0) return;

		const halfDuration = Math.max(
			0,
			Math.floor((traffic_bar.duration_ms || 500) / 2),
		);
		let swapTimer: ReturnType<typeof setTimeout> | undefined;

		const timer = setInterval(() => {
			if (halfDuration > 0) {
				setFading(true);
				swapTimer = setTimeout(() => {
					setSlideIndex((prev) => (prev + 1) % 4);
					setFading(false);
				}, halfDuration);
			} else {
				setSlideIndex((prev) => (prev + 1) % 4);
			}
		}, interval);

		return () => {
			clearInterval(timer);
			if (swapTimer) clearTimeout(swapTimer);
		};
	}, [
		traffic_bar.enabled,
		traffic_bar.toggle_interval_ms,
		traffic_bar.duration_ms,
		serverStat,
	]);

	if (!traffic_bar.enabled || !serverStat) return null;

	const used = formatFileSizeParts(serverStat.transfer);
	const total = formatFileSizeParts(serverStat.max);
	const pctNum =
		serverStat.max > 0
			? Math.min(100, (serverStat.transfer / serverStat.max) * 100)
			: 0;
	const pctText =
		serverStat.max > 0
			? ((serverStat.transfer / serverStat.max) * 100).toFixed(2)
			: "0.00";
	const fromStr = formatShortDate(serverStat.from);
	const toStr = formatShortDate(serverStat.to);
	const remainDays = calculateRemainingDaysUntil(serverStat.to);
	const barColor = getTrafficGradientColor(pctNum);
	const halfDuration = Math.max(
		50,
		Math.floor((traffic_bar.duration_ms || 500) / 2),
	);

	const slides = [
		<span key="range">
			{fromStr}
			<span className="text-neutral-500 dark:text-neutral-400"> - </span>
			{toStr}
		</span>,
		<span key="pct" className="text-neutral-800 dark:text-neutral-200">
			使用占比: {pctText}%
		</span>,
		<span key="reset" className="text-neutral-800 dark:text-neutral-200">
			流量重置日: {toStr}
		</span>,
		<span key="days" className="text-sky-600 dark:text-sky-400">
			剩余 {remainDays} 天重置
		</span>,
	];

	return (
		<div className="w-full space-y-1.5" data-nz-traffic-bar>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-baseline gap-0.5 text-[10px]">
					<span className="font-medium text-neutral-800 dark:text-neutral-200">
						{used.value} {used.unit}
					</span>
					<span className="text-neutral-500 dark:text-neutral-400">
						{" / "}
						{total.value} {total.unit}
					</span>
				</div>
				<div
					className="text-[10px] font-medium text-neutral-600 dark:text-neutral-300 min-h-[15px]"
					style={{
						opacity: fading ? 0 : 1,
						transition: `opacity ${halfDuration}ms ease`,
					}}
				>
					{slides[slideIndex % slides.length]}
				</div>
			</div>
			<div className="relative h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
				<div
					className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
					style={{
						width: `${pctNum.toFixed(2)}%`,
						backgroundColor: barColor,
					}}
				/>
			</div>
		</div>
	);
}
