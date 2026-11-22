import { BarChart3, Calculator, Calendar, Globe2, Wallet } from "lucide-react";
import { lazy, memo, Suspense, useCallback, useMemo, useState } from "react";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { ExpiryAlertToasts } from "./ExpiryAlertToasts";
import { useThemeConfig } from "./theme-config";
import { WelcomeBubble } from "./WelcomeBubble";

const LazyFinanceWidget = lazy(() =>
	import("./FinanceWidget").then((m) => ({ default: m.FinanceWidget })),
);
const LazyTradeCalculatorModal = lazy(() =>
	import("./TradeCalculatorModal").then((m) => ({
		default: m.TradeCalculatorModal,
	})),
);
const LazyEarthGlobeModal = lazy(() =>
	import("./EarthGlobeModal").then((m) => ({ default: m.EarthGlobeModal })),
);
const LazyTrafficAnalyticsPanel = lazy(() =>
	import("./TrafficAnalyticsPanel").then((m) => ({
		default: m.TrafficAnalyticsPanel,
	})),
);
const LazyRenewalCalendarModal = lazy(() =>
	import("./RenewalCalendarModal").then((m) => ({
		default: m.RenewalCalendarModal,
	})),
);

type ActiveTool = null | "finance" | "trade" | "earth" | "traffic" | "calendar";

const MemoWelcomeBubble = memo(WelcomeBubble);

/**
 * Isolated WebSocket subscriber for expiry alerts.
 * Unsubscribes completely once dismissed or auto-hidden so live WS ticks do 0 work.
 */
function ExpiryAlertRunner() {
	const { renewal_calendar } = useThemeConfig();
	const [done, setDone] = useState(false);

	if (!renewal_calendar.enable_expiry_alerts || done) {
		return null;
	}
	return <ExpiryAlertSubscriber onDone={() => setDone(true)} />;
}

function ExpiryAlertSubscriber({ onDone }: { onDone: () => void }) {
	const { lastData } = useWebSocketContext();
	const servers = lastData?.servers ?? [];
	return <ExpiryAlertToasts servers={servers} onAllDismissed={onDone} />;
}

/**
 * Only subscribes to live WebSocket servers while a tool panel/modal is open.
 * When idle (activeTool === null), zero tool code or billing computation runs.
 */
function ActiveToolRenderer({
	activeTool,
	onClose,
}: {
	activeTool: Exclude<ActiveTool, null>;
	onClose: () => void;
}) {
	const { lastData } = useWebSocketContext();
	const servers = lastData?.servers ?? [];

	return (
		<Suspense fallback={null}>
			{activeTool === "finance" && (
				<LazyFinanceWidget open onClose={onClose} servers={servers} />
			)}
			{activeTool === "trade" && (
				<LazyTradeCalculatorModal open onClose={onClose} servers={servers} />
			)}
			{activeTool === "earth" && (
				<LazyEarthGlobeModal open onClose={onClose} servers={servers} />
			)}
			{activeTool === "traffic" && (
				<LazyTrafficAnalyticsPanel open onClose={onClose} servers={servers} />
			)}
			{activeTool === "calendar" && (
				<LazyRenewalCalendarModal open onClose={onClose} servers={servers} />
			)}
		</Suspense>
	);
}

export function ThemeCustomOverlay() {
	const themeConfig = useThemeConfig();
	const [activeTool, setActiveTool] = useState<ActiveTool>(null);

	const toggleTool = useCallback((tool: Exclude<ActiveTool, null>) => {
		setActiveTool((prev) => (prev === tool ? null : tool));
	}, []);

	const closeTool = useCallback(() => {
		setActiveTool(null);
	}, []);

	const dockTools = useMemo(
		() =>
			[
				themeConfig.finance_widget.enabled && {
					key: "finance" as const,
					title: "资产统计",
					icon: <Wallet className="h-[19px] w-[19px]" />,
				},
				themeConfig.trade_calc.enabled && {
					key: "trade" as const,
					title: "VPS 交易工作站",
					icon: <Calculator className="h-[19px] w-[19px]" />,
				},
				themeConfig.earth_globe.enabled && {
					key: "earth" as const,
					title: "3D 节点拓扑图",
					icon: <Globe2 className="h-[19px] w-[19px]" />,
				},
				themeConfig.traffic_stats.enabled && {
					key: "traffic" as const,
					title: "全维度流量透视",
					icon: <BarChart3 className="h-[19px] w-[19px]" />,
				},
				themeConfig.renewal_calendar.enabled && {
					key: "calendar" as const,
					title: "资产续费日程表",
					icon: <Calendar className="h-[19px] w-[19px]" />,
				},
			].filter(Boolean) as Array<{
				key: Exclude<ActiveTool, null>;
				title: string;
				icon: React.ReactNode;
			}>,
		[
			themeConfig.finance_widget.enabled,
			themeConfig.trade_calc.enabled,
			themeConfig.earth_globe.enabled,
			themeConfig.traffic_stats.enabled,
			themeConfig.renewal_calendar.enabled,
		],
	);

	const showDock = themeConfig.dock.enabled && dockTools.length > 0;
	const dockPosClass =
		themeConfig.dock.position === "left" ? "pos-left" : "pos-right";

	return (
		<>
			{/* Visitor Welcome Bubble (isolated from WS ticks) */}
			<MemoWelcomeBubble />

			{/* Expiry Alert Toasts (unsubscribes automatically after dismissal/timeout) */}
			<ExpiryAlertRunner />

			{/* Mac-style Capsule Floating Dock (isolated from WS ticks) */}
			{showDock && (
				<nav aria-label="快捷工具栏" className={`nz-mac-dock ${dockPosClass}`}>
					{dockTools.map((tool) => (
						<button
							key={tool.key}
							type="button"
							title={tool.title}
							aria-label={tool.title}
							aria-pressed={activeTool === tool.key}
							onClick={() => toggleTool(tool.key)}
							className={`nz-dock-btn ${activeTool === tool.key ? "is-active" : ""}`}
						>
							{tool.icon}
						</button>
					))}
				</nav>
			)}

			{/* Lazy-loaded & conditionally mounted active tool */}
			{activeTool && (
				<ActiveToolRenderer activeTool={activeTool} onClose={closeTool} />
			)}
		</>
	);
}
