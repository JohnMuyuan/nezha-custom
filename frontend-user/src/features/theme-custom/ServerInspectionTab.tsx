import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	ClipboardList,
	Globe,
	Loader2,
	Mail,
	RefreshCw,
	Route,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	Tv,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLoginUser } from "@/hooks/use-login-user";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { cn } from "@/lib/utils";
import {
	fetchServerInspection,
	type MediaCheckItem,
	triggerServerInspection,
} from "./inspection-api";
import { ServerShowcaseModal } from "./ServerShowcaseModal";
import { useThemeConfig } from "./theme-config";

function getStatusBadge(item: MediaCheckItem): {
	label: string;
	cls: string;
	icon: "ok" | "warn" | "no" | "na";
} {
	const reg = item.region ? ` (${item.region})` : "";
	switch (item.status) {
		case "full":
			return {
				label: `全解锁${reg}`,
				cls: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
				icon: "ok",
			};
		case "yes":
			return {
				label: `已解锁${reg}`,
				cls: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
				icon: "ok",
			};
		case "originals":
			return {
				label: "仅自制剧",
				cls: "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300",
				icon: "warn",
			};
		case "web":
			return {
				label: `仅网页${reg}`,
				cls: "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300",
				icon: "warn",
			};
		case "cn":
			return {
				label: "已送中 (CN)",
				cls: "border-orange-500/35 bg-orange-500/12 text-orange-700 dark:text-orange-300",
				icon: "warn",
			};
		case "no":
			return {
				label: `不支持${reg}`,
				cls: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
				icon: "no",
			};
		default:
			return {
				label: "超时/未测",
				cls: "border-border bg-muted/40 text-muted-foreground",
				icon: "na",
			};
	}
}

function getTierBadgeClass(tier: string): string {
	switch (tier) {
		case "premium":
			return "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
		case "good":
			return "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300";
		case "standard":
			return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
		default:
			return "border-border bg-muted/40 text-muted-foreground";
	}
}

function formatCheckTime(iso?: string): string {
	if (!iso || iso.startsWith("0001")) return "尚未检测";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "尚未检测";
	return d.toLocaleString("zh-CN", { hour12: false });
}

export default function ServerInspectionTab({
	server_id,
}: {
	server_id: number;
}) {
	const { media_unlock, showcase_card } = useThemeConfig();
	const queryClient = useQueryClient();
	const { lastData } = useWebSocketContext();
	const server = lastData?.servers?.find((s) => s.id === server_id);

	const [stackTab, setStackTab] = useState<"v4" | "v6">("v4");
	const [triggering, setTriggering] = useState(false);
	const [showcaseOpen, setShowcaseOpen] = useState(false);

	const { data: loginUser, isAuthenticated } = useLoginUser();
	const isAdmin = isAuthenticated && loginUser?.data?.role === 0;

	const { data: inspection, isLoading } = useQuery({
		queryKey: ["server-inspection", server_id],
		queryFn: () => fetchServerInspection(server_id),
		refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
		staleTime: 15_000,
		retry: false,
	});

	const handleRunInspection = async (scopes?: string[]) => {
		setTriggering(true);
		try {
			await triggerServerInspection(server_id, scopes);
			toast.success("已下发节点体检任务，通常需要 10~25 秒完成");
			await queryClient.invalidateQueries({
				queryKey: ["server-inspection", server_id],
			});
			await queryClient.invalidateQueries({ queryKey: ["server-inspections"] });
		} catch (err) {
			toast.error("触发体检失败", {
				description: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setTriggering(false);
		}
	};

	const media = inspection?.media;
	const backhaul = inspection?.backhaul;
	const ipq = inspection?.ip_quality;
	const isRunning = Boolean(inspection?.running || triggering);

	const activeMediaItems: MediaCheckItem[] =
		stackTab === "v6" ? (media?.ipv6 ?? []) : (media?.ipv4 ?? []);
	const streamingItems = activeMediaItems.filter((i) => i.category !== "ai");
	const aiItems = activeMediaItems.filter((i) => i.category === "ai");

	return (
		<div className="space-y-4">
			{/* Action header bar */}
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/85 px-4 py-3 backdrop-blur-sm">
				<div className="space-y-0.5">
					<div className="flex items-center gap-2 text-sm font-bold">
						<Tv className="h-4 w-4 text-primary" />
						<span>节点能力体检中心（流媒体 / AI / 回程 / IP 质量）</span>
						{isRunning && (
							<span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
								<Loader2 className="h-3 w-3 animate-spin" />
								检测中...
							</span>
						)}
					</div>
					<div className="text-xs text-muted-foreground">
						最近体检时间：{formatCheckTime(inspection?.updated_at)}
						{media_unlock.auto_interval_hours > 0 && (
							<span className="ml-2 text-muted-foreground/80">
								·{" "}
								{media_unlock.auto_interval_hours === 24
									? "每日自动体检"
									: `每 ${media_unlock.auto_interval_hours} 小时自动体检`}
							</span>
						)}
						{inspection?.last_error && (
							<span className="ml-2 text-amber-600 dark:text-amber-400">
								（部分项提示：{inspection.last_error}）
							</span>
						)}
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{showcase_card.enabled && server && (
						<button
							type="button"
							onClick={() => setShowcaseOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs font-semibold hover:bg-muted"
						>
							<ClipboardList className="h-3.5 w-3.5 text-primary" />
							生成测评卡片
						</button>
					)}
					{isAdmin && (
						<button
							type="button"
							disabled={isRunning}
							onClick={() => void handleRunInspection()}
							className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
						>
							<RefreshCw
								className={cn("h-3.5 w-3.5", isRunning && "animate-spin")}
							/>
							{isRunning ? "正在检测..." : "立即重新体检"}
						</button>
					)}
				</div>
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-card/70 py-14 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					正在读取节点体检报告...
				</div>
			) : (
				<>
					{/* 1. Media & AI Unlock Section */}
					<section className="rounded-xl border border-border/70 bg-card/85 p-4 shadow-xs backdrop-blur-sm">
						<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
							<div className="flex items-center gap-2">
								<Sparkles className="h-4 w-4 text-primary" />
								<h3 className="text-sm font-bold">流媒体 & AI 服务解锁能力</h3>
							</div>
							<div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5 text-xs">
								<button
									type="button"
									onClick={() => setStackTab("v4")}
									className={cn(
										"rounded-md px-2.5 py-1 font-semibold transition-colors",
										stackTab === "v4"
											? "bg-card text-foreground shadow-xs"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									IPv4 {media?.ipv4_available ? "✓" : ""}
								</button>
								{media_unlock.check_ipv6 && (
									<button
										type="button"
										onClick={() => setStackTab("v6")}
										className={cn(
											"rounded-md px-2.5 py-1 font-semibold transition-colors",
											stackTab === "v6"
												? "bg-card text-foreground shadow-xs"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										IPv6 {media?.ipv6_available ? "✓" : "(无)"}
									</button>
								)}
							</div>
						</div>

						{!media ? (
							<div className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
								该节点尚未生成流媒体解锁体检报告。
								{isAdmin
									? "可点击右上角「立即重新体检」，或等待每日自动定时任务运行。"
									: "系统每日自动定时体检完成后即可展示结果。"}
							</div>
						) : stackTab === "v6" && !media.ipv6_available ? (
							<div className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
								当前节点未检测到可用的公网 IPv6 出口。
							</div>
						) : (
							<div className="space-y-4">
								{streamingItems.length > 0 && (
									<div>
										<div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
											主流流媒体平台
										</div>
										<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
											{streamingItems.map((item) => {
												const badge = getStatusBadge(item);
												return (
													<div
														key={item.platform}
														className="flex flex-col justify-between gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-2.5"
													>
														<span className="truncate text-xs font-bold">
															{item.name}
														</span>
														<span
															className={cn(
																"inline-flex w-fit items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
																badge.cls,
															)}
														>
															{badge.icon === "ok" && (
																<CheckCircle2 className="h-3 w-3 shrink-0" />
															)}
															{badge.icon === "no" && (
																<XCircle className="h-3 w-3 shrink-0" />
															)}
															{badge.label}
														</span>
													</div>
												);
											})}
										</div>
									</div>
								)}

								{aiItems.length > 0 && (
									<div>
										<div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
											AI 人工智能服务
										</div>
										<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
											{aiItems.map((item) => {
												const badge = getStatusBadge(item);
												return (
													<div
														key={item.platform}
														className="flex flex-col justify-between gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-2.5"
													>
														<span className="truncate text-xs font-bold">
															{item.name}
														</span>
														<span
															className={cn(
																"inline-flex w-fit items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
																badge.cls,
															)}
														>
															{badge.icon === "ok" && (
																<CheckCircle2 className="h-3 w-3 shrink-0" />
															)}
															{badge.icon === "no" && (
																<XCircle className="h-3 w-3 shrink-0" />
															)}
															{badge.label}
														</span>
													</div>
												);
											})}
										</div>
									</div>
								)}
							</div>
						)}
					</section>

					{/* 2. Three-Network Backhaul + 3. IP Quality Grid */}
					<div className="grid gap-4 lg:grid-cols-2">
						{/* Backhaul Routing */}
						{media_unlock.check_backhaul && (
							<section className="rounded-xl border border-border/70 bg-card/85 p-4 shadow-xs backdrop-blur-sm">
								<div className="mb-3 flex items-center justify-between">
									<div className="flex items-center gap-2">
										<Route className="h-4 w-4 text-primary" />
										<h3 className="text-sm font-bold">三网回程路由简报</h3>
									</div>
									{backhaul?.tool && (
										<span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
											{backhaul.tool}
										</span>
									)}
								</div>

								{!backhaul || backhaul.routes.length === 0 ? (
									<div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
										{backhaul && !backhaul.tool
											? "目标小鸡未安装 mtr / traceroute / tracepath，跳过回程追踪。"
											: "暂无三网回程路由数据。"}
									</div>
								) : (
									<div className="space-y-2.5">
										{backhaul.routes.map((r) => (
											<div
												key={r.isp}
												className="rounded-lg border border-border/60 bg-muted/20 p-3"
											>
												<div className="flex items-center justify-between gap-2">
													<div className="flex items-center gap-2">
														<span className="text-xs font-bold">
															中国{r.isp_label}
														</span>
														<span className="font-mono text-[10px] text-muted-foreground">
															({r.target})
														</span>
													</div>
													<span
														className={cn(
															"rounded-md border px-2 py-0.5 text-xs font-bold",
															getTierBadgeClass(r.tier),
														)}
													>
														{r.route_type}
													</span>
												</div>
												{r.hops && r.hops.length > 0 && (
													<details className="mt-2">
														<summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
															查看关键跳点 ({r.hops.length} 跳)
														</summary>
														<div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[10px] text-muted-foreground">
															{r.hops.map((ip, idx) => (
																<span
																	key={`${r.isp}-${ip}-${idx}`}
																	className="rounded bg-background/80 px-1.5 py-0.5"
																>
																	{idx + 1}. {ip}
																</span>
															))}
														</div>
													</details>
												)}
											</div>
										))}
									</div>
								)}
							</section>
						)}

						{/* IP Quality / Risk / SMTP 25 */}
						{media_unlock.check_ip_quality && (
							<section className="rounded-xl border border-border/70 bg-card/85 p-4 shadow-xs backdrop-blur-sm">
								<div className="mb-3 flex items-center justify-between">
									<div className="flex items-center gap-2">
										{ipq?.risk_level === "high" ? (
											<ShieldAlert className="h-4 w-4 text-red-500" />
										) : (
											<ShieldCheck className="h-4 w-4 text-emerald-500" />
										)}
										<h3 className="text-sm font-bold">
											IP 质量 / 风控 & 25 端口体检
										</h3>
									</div>
									{ipq?.risk_level && ipq.risk_level !== "unknown" && (
										<span
											className={cn(
												"rounded-md border px-2 py-0.5 text-[11px] font-bold",
												ipq.risk_level === "low"
													? "border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
													: ipq.risk_level === "medium"
														? "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300"
														: "border-red-500/35 bg-red-500/12 text-red-600 dark:text-red-400",
											)}
										>
											风险：
											{ipq.risk_level === "low"
												? "低"
												: ipq.risk_level === "medium"
													? "中"
													: "高"}
										</span>
									)}
								</div>

								{!ipq ? (
									<div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
										暂无 IP 体检数据。
									</div>
								) : (
									<div className="grid grid-cols-2 gap-2.5 text-xs">
										<div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
											<div className="text-[11px] text-muted-foreground">
												IP 属性参考
											</div>
											<div className="mt-1 font-bold">
												{ipq.ip_type === "residential"
													? "🏠 家宽 / ISP"
													: ipq.ip_type === "mobile"
														? "📱 移动蜂窝"
														: ipq.ip_type === "datacenter"
															? "🏢 机房 / IDC"
															: "未知"}
											</div>
										</div>
										<div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
											<div className="text-[11px] text-muted-foreground">
												ASN / 运营商
											</div>
											<div
												className="mt-1 truncate font-bold"
												title={ipq.org || ipq.isp}
											>
												{ipq.asn || "-"} {ipq.isp || ipq.org || ""}
											</div>
										</div>
										<div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
											<div className="flex items-center gap-1 text-[11px] text-muted-foreground">
												<Globe className="h-3 w-3" />
												Google 地区 / 送中
											</div>
											<div
												className={cn(
													"mt-1 font-bold",
													ipq.google_cn
														? "text-orange-600 dark:text-orange-400"
														: "text-emerald-600 dark:text-emerald-400",
												)}
											>
												{ipq.google_cn
													? "⚠️ 已送中 (CN)"
													: ipq.google_region
														? `正常 (${ipq.google_region})`
														: "正常 / 未识别"}
											</div>
										</div>
										<div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
											<div className="flex items-center gap-1 text-[11px] text-muted-foreground">
												<Mail className="h-3 w-3" />
												SMTP 25 端口出站
											</div>
											<div
												className={cn(
													"mt-1 font-bold",
													ipq.smtp_25_open === true
														? "text-emerald-600 dark:text-emerald-400"
														: ipq.smtp_25_open === false
															? "text-muted-foreground"
															: "",
												)}
											>
												{ipq.smtp_25_open === true
													? "✅ 开放（可发信）"
													: ipq.smtp_25_open === false
														? "🔒 已封禁"
														: "未检测"}
											</div>
										</div>
										<div className="col-span-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
											<div className="flex flex-wrap items-center justify-between gap-2">
												<span className="text-[11px] text-muted-foreground">
													DNSBL 垃圾邮件黑名单 & 风险标签
												</span>
												<div className="flex flex-wrap gap-1.5">
													{ipq.dnsbl_clean === true && (
														<span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
															黑名单洁净
														</span>
													)}
													{ipq.dnsbl_listed && ipq.dnsbl_listed.length > 0 && (
														<span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
															命中: {ipq.dnsbl_listed.join(", ")}
														</span>
													)}
													{ipq.is_proxy && (
														<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
															Proxy
														</span>
													)}
													{ipq.is_vpn && (
														<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
															VPN
														</span>
													)}
													{ipq.is_tor && (
														<span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
															Tor
														</span>
													)}
													{ipq.is_abuser && (
														<span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
															Abuser
														</span>
													)}
												</div>
											</div>
										</div>
									</div>
								)}
							</section>
						)}
					</div>
				</>
			)}

			{showcaseOpen && server && (
				<ServerShowcaseModal
					open={showcaseOpen}
					onClose={() => setShowcaseOpen(false)}
					server={server}
					inspection={inspection}
				/>
			)}
		</div>
	);
}
