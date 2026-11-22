import { ClipboardList } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useParams } from "react-router-dom";
import OnlineHistorySkeleton from "@/components/loading/OnlineHistorySkeleton";
import { ServerDetailChartLoading } from "@/components/loading/ServerDetailLoading";
import NetworkChartLoading from "@/components/NetworkChartLoading";
import RetryableLazy from "@/components/RetryableLazy";
import ServerDetailOverview from "@/components/ServerDetailOverview";
import TabSwitch from "@/components/TabSwitch";
import { Separator } from "@/components/ui/separator";
import { useThemeConfig } from "@/features/theme-custom/theme-config";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import {
	getPreloadedServerDetailChart,
	loadServerDetailChart,
} from "@/lib/server-detail-preload";

const loadNetworkChart = () =>
	import("@/components/NetworkChart").then((module) => ({
		default: module.NetworkChart,
	}));

const loadOnlineHistory = () =>
	import("@/components/ServerDetailOnlineHistory").then((module) => ({
		default: module.default,
	}));

const loadServerInspectionTab = () =>
	import("@/features/theme-custom/ServerInspectionTab").then((module) => ({
		default: module.default,
	}));

const LazyServerShowcaseModal = lazy(() =>
	import("@/features/theme-custom/ServerShowcaseModal").then((module) => ({
		default: module.ServerShowcaseModal,
	})),
);

export default function ServerDetail() {
	const { t } = useTranslation();
	const { media_unlock, showcase_card } = useThemeConfig();
	const { lastData } = useWebSocketContext();
	const [showcaseOpen, setShowcaseOpen] = useState(false);

	useEffect(() => {
		window.scrollTo({ top: 0, left: 0, behavior: "instant" });
	}, []);

	const { id: server_id } = useParams();
	const numericServerId = Number(server_id);
	const activeServer = lastData?.servers?.find((s) => s.id === numericServerId);
	const isMainlandChina =
		activeServer?.country_code?.trim().toUpperCase() === "CN";
	const showUnlockTab =
		media_unlock.enabled &&
		!(media_unlock.skip_china_mainland && isMainlandChina);

	const tabs = useMemo(
		() =>
			showUnlockTab
				? ["Detail", "Network", "Online", "Unlock"]
				: ["Detail", "Network", "Online"],
		[showUnlockTab],
	);
	const [currentTab, setCurrentTab] = useState("Detail");

	useEffect(() => {
		if (!showUnlockTab && currentTab === "Unlock") {
			setCurrentTab("Detail");
		}
	}, [showUnlockTab, currentTab]);

	if (!server_id) {
		return <Navigate to="/404" replace />;
	}

	return (
		<div className="mx-auto w-full max-w-5xl px-0 flex flex-col gap-4 server-info">
			<ServerDetailOverview server_id={server_id} />
			<section className="flex items-center my-2 w-full gap-2">
				<Separator className="flex-1" />
				<div className="flex items-center justify-center gap-2 shrink-0">
					<TabSwitch
						tabs={tabs}
						currentTab={currentTab}
						setCurrentTab={setCurrentTab}
					/>
					{showcase_card.enabled && activeServer && (
						<button
							type="button"
							onClick={() => setShowcaseOpen(true)}
							className="inline-flex h-8 items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 text-xs font-semibold text-stone-700 shadow-xs transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
							title="一键生成节点测评 / 分享卡片"
						>
							<ClipboardList className="h-3.5 w-3.5 text-blue-500" />
							<span className="hidden sm:inline">测评卡片</span>
						</button>
					)}
				</div>
				<Separator className="flex-1" />
			</section>

			{currentTab === "Detail" && (
				<RetryableLazy
					load={loadServerDetailChart}
					getPreloaded={getPreloadedServerDetailChart}
					componentProps={{ server_id }}
					fallback={<ServerDetailChartLoading />}
					resetKey={server_id}
					title={t("error.chartFailed")}
				/>
			)}
			{currentTab === "Network" && (
				<RetryableLazy
					load={loadNetworkChart}
					componentProps={{ server_id: numericServerId, show: true }}
					fallback={<NetworkChartLoading />}
					resetKey={server_id}
					title={t("error.chartFailed")}
				/>
			)}
			{currentTab === "Online" && (
				<RetryableLazy
					load={loadOnlineHistory}
					componentProps={{ server_id }}
					fallback={<OnlineHistorySkeleton />}
					resetKey={server_id}
					title={t("error.chartFailed")}
				/>
			)}
			{currentTab === "Unlock" && showUnlockTab && (
				<RetryableLazy
					load={loadServerInspectionTab}
					componentProps={{ server_id: numericServerId }}
					fallback={<OnlineHistorySkeleton />}
					resetKey={server_id}
					title={t("error.chartFailed")}
				/>
			)}

			{showcaseOpen && activeServer && (
				<Suspense fallback={null}>
					<LazyServerShowcaseModal
						open={showcaseOpen}
						onClose={() => setShowcaseOpen(false)}
						server={activeServer}
					/>
				</Suspense>
			)}
		</div>
	);
}
