import { BarChart3, Calculator, Calendar, Globe2, Wallet } from "lucide-react";
import { useState } from "react";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { EarthGlobeModal } from "./EarthGlobeModal";
import { FinanceWidget } from "./FinanceWidget";
import {
	ExpiryAlertToasts,
	RenewalCalendarModal,
} from "./RenewalCalendarModal";
import { TradeCalculatorModal } from "./TradeCalculatorModal";
import { TrafficAnalyticsPanel } from "./TrafficAnalyticsPanel";
import { useThemeConfig } from "./theme-config";
import { WelcomeBubble } from "./WelcomeBubble";

type ActiveTool = null | "finance" | "trade" | "earth" | "traffic" | "calendar";

export function ThemeCustomOverlay() {
	const themeConfig = useThemeConfig();
	const { lastData } = useWebSocketContext();
	const servers = lastData?.servers ?? [];
	const [activeTool, setActiveTool] = useState<ActiveTool>(null);

	const toggleTool = (tool: Exclude<ActiveTool, null>) => {
		setActiveTool((prev) => (prev === tool ? null : tool));
	};

	const dockTools = [
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
	}>;

	const showDock = themeConfig.dock.enabled && dockTools.length > 0;
	const dockPosClass =
		themeConfig.dock.position === "left" ? "pos-left" : "pos-right";

	return (
		<>
			{/* Visitor Welcome Bubble */}
			<WelcomeBubble />

			{/* Expiry Alert Toasts */}
			<ExpiryAlertToasts servers={servers} />

			{/* Mac-style Capsule Floating Dock */}
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

			{/* Floating Panels & Native Modals */}
			{themeConfig.finance_widget.enabled && (
				<FinanceWidget
					open={activeTool === "finance"}
					onClose={() => setActiveTool(null)}
					servers={servers}
				/>
			)}
			{themeConfig.trade_calc.enabled && (
				<TradeCalculatorModal
					open={activeTool === "trade"}
					onClose={() => setActiveTool(null)}
					servers={servers}
				/>
			)}
			{themeConfig.earth_globe.enabled && (
				<EarthGlobeModal
					open={activeTool === "earth"}
					onClose={() => setActiveTool(null)}
					servers={servers}
				/>
			)}
			{themeConfig.traffic_stats.enabled && (
				<TrafficAnalyticsPanel
					open={activeTool === "traffic"}
					onClose={() => setActiveTool(null)}
					servers={servers}
				/>
			)}
			{themeConfig.renewal_calendar.enabled && (
				<RenewalCalendarModal
					open={activeTool === "calendar"}
					onClose={() => setActiveTool(null)}
					servers={servers}
				/>
			)}
		</>
	);
}
