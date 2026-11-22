import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Copy, Download, ImageIcon, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/format";
import { fetchMonitor } from "@/lib/nezha-api";
import type { NezhaServer } from "@/types/nezha-api";
import { CustomModalDialog } from "./CustomModalDialog";
import {
	fetchServerInspection,
	isUnlockedStatus,
	type ServerInspectionPayload,
} from "./inspection-api";
import { parseServerBilling } from "./server-billing";
import { useThemeConfig } from "./theme-config";

function extractLatestPings(
	monitors?: Array<{ monitor_name?: string; avg_delay?: Array<number | null> }>,
) {
	const result: Array<{ label: string; ping: number }> = [];
	if (!monitors) return result;
	for (const m of monitors) {
		const name = m.monitor_name || "";
		if (!/电信|联通|移动|CT|CU|CM|Telecom|Unicom|Mobile/i.test(name)) continue;
		const delays = m.avg_delay ?? [];
		let val = 0;
		for (let i = delays.length - 1; i >= 0; i -= 1) {
			const d = delays[i];
			if (typeof d === "number" && d > 0) {
				val = Number(d.toFixed(1));
				break;
			}
		}
		if (val > 0) result.push({ label: name, ping: val });
	}
	return result.slice(0, 6);
}

function drawShowcasePoster(
	canvas: HTMLCanvasElement,
	opts: {
		serverName: string;
		countryCode: string;
		specs: string;
		billingText: string;
		remainText: string;
		pings: Array<{ label: string; ping: number }>;
		routes: Array<{ label: string; route: string }>;
		unlocked: string[];
		ipSummary: string;
		siteTitle: string;
	},
) {
	const width = 920;
	const height = 540;
	const dpr = 2;
	canvas.width = width * dpr;
	canvas.height = height * dpr;
	canvas.style.width = "100%";
	canvas.style.height = "auto";

	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.scale(dpr, dpr);

	// Background gradient
	const bg = ctx.createLinearGradient(0, 0, width, height);
	bg.addColorStop(0, "#0b1120");
	bg.addColorStop(0.55, "#111b33");
	bg.addColorStop(1, "#0f172a");
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, width, height);

	// Subtle decorative glow
	const glow = ctx.createRadialGradient(780, 90, 10, 780, 90, 280);
	glow.addColorStop(0, "rgba(59, 130, 246, 0.25)");
	glow.addColorStop(1, "rgba(59, 130, 246, 0)");
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, width, height);

	// Border frame
	ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.roundRect(18, 18, width - 36, height - 36, 18);
	ctx.stroke();

	const fontSans =
		"system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";

	// Header
	ctx.fillStyle = "#60a5fa";
	ctx.font = `700 13px ${fontSans}`;
	ctx.fillText(
		`VPS NODE AUDIT CARD  •  ${opts.countryCode || "GLOBAL"}`,
		44,
		58,
	);

	ctx.fillStyle = "#f8fafc";
	ctx.font = `800 28px ${fontSans}`;
	ctx.fillText(opts.serverName.slice(0, 36), 44, 96);

	ctx.fillStyle = "#94a3b8";
	ctx.font = `500 14px ${fontSans}`;
	ctx.fillText(opts.specs.slice(0, 82), 44, 124);

	// Info cards row
	const drawBox = (
		x: number,
		y: number,
		w: number,
		h: number,
		title: string,
		lines: string[],
	) => {
		ctx.fillStyle = "rgba(30, 41, 59, 0.72)";
		ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.roundRect(x, y, w, h, 12);
		ctx.fill();
		ctx.stroke();

		ctx.fillStyle = "#38bdf8";
		ctx.font = `700 13px ${fontSans}`;
		ctx.fillText(title, x + 16, y + 26);

		ctx.fillStyle = "#e2e8f0";
		ctx.font = `500 13px ${fontSans}`;
		lines.slice(0, 4).forEach((line, idx) => {
			ctx.fillText(line.slice(0, 42), x + 16, y + 52 + idx * 24);
		});
	};

	drawBox(44, 148, 404, 152, "💰 账单与剩余价值", [
		`套餐费用：${opts.billingText}`,
		`剩余价值：${opts.remainText}`,
		`IP 体检：${opts.ipSummary}`,
	]);

	drawBox(472, 148, 404, 152, "🛣️ 三网回程与实时延迟", [
		opts.routes.length > 0
			? opts.routes.map((r) => `${r.label}: ${r.route}`).join(" | ")
			: "回程路由：暂无体检记录",
		...(opts.pings.length > 0
			? [
					opts.pings
						.slice(0, 3)
						.map((p) => `${p.label} ${p.ping}ms`)
						.join("  "),
					opts.pings
						.slice(3, 6)
						.map((p) => `${p.label} ${p.ping}ms`)
						.join("  "),
				].filter(Boolean)
			: ["三网延迟：请在详情页网络图表查看"]),
	]);

	// Media Unlock section
	ctx.fillStyle = "rgba(30, 41, 59, 0.72)";
	ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
	ctx.beginPath();
	ctx.roundRect(44, 320, 832, 152, 12);
	ctx.fill();
	ctx.stroke();

	ctx.fillStyle = "#34d399";
	ctx.font = `700 13px ${fontSans}`;
	ctx.fillText("🎬 流媒体 & AI 服务解锁摘要", 60, 348);

	if (opts.unlocked.length === 0) {
		ctx.fillStyle = "#94a3b8";
		ctx.font = `500 14px ${fontSans}`;
		ctx.fillText(
			"尚未运行流媒体解锁体检，请在详情页「流媒体 & 体检」触发检测",
			60,
			386,
		);
	} else {
		let cx = 60;
		let cy = 374;
		ctx.font = `600 13px ${fontSans}`;
		for (const tag of opts.unlocked.slice(0, 14)) {
			const tw = ctx.measureText(tag).width + 24;
			if (cx + tw > 856) {
				cx = 60;
				cy += 36;
			}
			ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
			ctx.strokeStyle = "rgba(52, 211, 153, 0.45)";
			ctx.beginPath();
			ctx.roundRect(cx, cy, tw, 26, 8);
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = "#a7f3d0";
			ctx.fillText(tag, cx + 12, cy + 17);
			cx += tw + 10;
		}
	}

	// Footer
	ctx.fillStyle = "#64748b";
	ctx.font = `500 12px ${fontSans}`;
	ctx.fillText(
		`Generated by ${opts.siteTitle}  •  ${new Date().toLocaleDateString("zh-CN")}`,
		44,
		504,
	);
}

export function ServerShowcaseModal({
	open,
	onClose,
	server,
	inspection: providedInspection,
}: {
	open: boolean;
	onClose: () => void;
	server: NezhaServer;
	inspection?: ServerInspectionPayload;
}) {
	const { remaining_value, appearance } = useThemeConfig();
	const titleId = useId();
	const previewTextareaId = useId();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [tab, setTab] = useState<"markdown" | "poster">("markdown");

	const { data: fetchedInspection } = useQuery({
		queryKey: ["server-inspection", server.id],
		queryFn: () => fetchServerInspection(server.id),
		enabled: open && !providedInspection,
		staleTime: 15_000,
		retry: false,
	});
	const inspection = providedInspection ?? fetchedInspection;

	const { data: monitorResp } = useQuery({
		queryKey: ["monitor-showcase", server.id],
		queryFn: () => fetchMonitor(server.id, "1d"),
		enabled: open,
		staleTime: 30_000,
		retry: false,
	});

	const billing = useMemo(
		() => parseServerBilling(server, remaining_value.default_currency || "$"),
		[server, remaining_value.default_currency],
	);

	const pings = useMemo(
		() => extractLatestPings(monitorResp?.data),
		[monitorResp?.data],
	);

	const cpuSpec = server.host.cpu?.[0] || "Unknown CPU";
	const specsLine = `${cpuSpec} | RAM ${formatBytes(server.host.mem_total)} | Disk ${formatBytes(server.host.disk_total)} | ${server.host.platform || "Linux"}`;

	const billingText = billing
		? billing.isFree
			? "免费 / 赠机"
			: `${billing.currencySymbol}${billing.price}/${billing.cycleLabel}${billing.expiryDateStr ? ` (到期 ${billing.expiryDateStr})` : ""}`
		: "未登记账单";

	const remainText =
		billing && billing.remainingValue !== null
			? `${billing.currencySymbol}${billing.remainingValue.toFixed(2)} (剩余 ${billing.remainingDays ?? 0} 天)`
			: "-";

	const routes = useMemo(
		() =>
			(inspection?.backhaul?.routes ?? []).map((r) => ({
				label: r.isp_label,
				route: r.route_type,
			})),
		[inspection?.backhaul?.routes],
	);

	const unlockedTags = useMemo(() => {
		const tags: string[] = [];
		for (const item of inspection?.media?.ipv4 ?? []) {
			if (!isUnlockedStatus(item.status)) continue;
			const reg = item.region ? ` (${item.region})` : "";
			tags.push(`${item.name}${item.status === "originals" ? " 自制" : reg}`);
		}
		return tags;
	}, [inspection?.media?.ipv4]);

	const ipSummary = useMemo(() => {
		const q = inspection?.ip_quality;
		if (!q) return "未检测";
		const parts: string[] = [];
		if (q.ip_type === "residential") parts.push("家宽/ISP");
		else if (q.ip_type === "datacenter") parts.push("机房IDC");
		if (q.asn) parts.push(q.asn);
		if (q.google_cn) parts.push("Google送中");
		else if (q.google_region) parts.push(`Google:${q.google_region}`);
		if (q.smtp_25_open === true) parts.push("25端口开放");
		else if (q.smtp_25_open === false) parts.push("25端口封禁");
		return parts.join(" · ") || "已检测";
	}, [inspection?.ip_quality]);

	const markdownContent = useMemo(() => {
		const osLabel = server.host.platform
			? `${server.host.platform}${server.host.platform_version ? ` ${server.host.platform_version}` : ""}`
			: "-";
		const lines: string[] = [
			`## 🖥️ 节点体检卡片：${server.name}`,
			"",
			"**【基础规格】**",
			`- 区域：\`${(server.country_code || "N/A").toUpperCase()}\` | 架构：\`${server.host.arch || "-"}\` | 系统：\`${osLabel}\``,
			`- 配置：${specsLine}`,
			`- 套餐与残值：${billingText} | 剩余价值：**${remainText}**`,
			"",
		];
		if (pings.length > 0) {
			lines.push("**【三网实时延迟】**");
			lines.push(pings.map((p) => `- ${p.label}：\`${p.ping} ms\``).join("\n"));
			lines.push("");
		}
		if (routes.length > 0) {
			lines.push("**【三网回程路由】**");
			lines.push(
				routes.map((r) => `- 中国${r.label}：**${r.route}**`).join("\n"),
			);
			lines.push("");
		}
		if (inspection?.media?.ipv4?.length) {
			lines.push("**【流媒体 & AI 解锁 (IPv4)】**");
			lines.push(
				unlockedTags.length > 0
					? `- ✅ 已解锁：${unlockedTags.join(" / ")}`
					: "- 暂无已解锁平台",
			);
			lines.push("");
		}
		if (inspection?.ip_quality) {
			lines.push("**【IP 质量与端口体检】**");
			lines.push(`- ${ipSummary}`);
			lines.push("");
		}
		lines.push(`> 由探针一键生成于 ${new Date().toLocaleDateString("zh-CN")}`);
		return lines.join("\n");
	}, [
		server.name,
		server.country_code,
		server.host.arch,
		server.host.platform,
		server.host.platform_version,
		specsLine,
		billingText,
		remainText,
		pings,
		routes,
		inspection?.media?.ipv4?.length,
		inspection?.ip_quality,
		unlockedTags,
		ipSummary,
	]);

	const [editableMd, setEditableMd] = useState(markdownContent);
	useEffect(() => {
		setEditableMd(markdownContent);
	}, [markdownContent]);

	useEffect(() => {
		if (!open || tab !== "poster" || !canvasRef.current) return;
		drawShowcasePoster(canvasRef.current, {
			serverName: server.name,
			countryCode: (server.country_code || "").toUpperCase(),
			specs: specsLine,
			billingText,
			remainText,
			pings,
			routes,
			unlocked: unlockedTags,
			ipSummary,
			siteTitle: appearance.custom_desc || "Nezha Custom",
		});
	}, [
		open,
		tab,
		server.name,
		server.country_code,
		specsLine,
		billingText,
		remainText,
		pings,
		routes,
		unlockedTags,
		ipSummary,
		appearance.custom_desc,
	]);

	const handleDownloadPng = () => {
		if (!canvasRef.current) return;
		const url = canvasRef.current.toDataURL("image/png");
		const a = document.createElement("a");
		a.href = url;
		a.download = `${server.name.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}_audit.png`;
		a.click();
		toast.success("节点测评海报 PNG 已开始下载");
	};

	return (
		<CustomModalDialog
			open={open}
			onClose={onClose}
			labelledBy={titleId}
			className="w-[min(94vw,760px)]"
		>
			<div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
				<h2 id={titleId} className="flex items-center gap-2 text-sm font-bold">
					<ClipboardList className="h-4 w-4 text-primary" />
					一键生成节点测评 / 分享卡片
				</h2>
				<button
					type="button"
					aria-label="关闭测评卡片弹窗"
					onClick={onClose}
					className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="p-5 space-y-4 overflow-y-auto nz-thin-scroll">
				<div className="flex gap-2 rounded-lg bg-muted/60 p-1 text-xs font-semibold">
					<button
						type="button"
						onClick={() => setTab("markdown")}
						className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition-colors ${
							tab === "markdown"
								? "bg-card text-foreground shadow-xs"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						<ClipboardList className="h-3.5 w-3.5" />
						Markdown 论坛测评帖
					</button>
					<button
						type="button"
						onClick={() => setTab("poster")}
						className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition-colors ${
							tab === "poster"
								? "bg-card text-foreground shadow-xs"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						<ImageIcon className="h-3.5 w-3.5" />
						可视化分享海报 (PNG)
					</button>
				</div>

				{tab === "markdown" ? (
					<div className="space-y-2.5">
						<label
							htmlFor={previewTextareaId}
							className="block text-xs text-muted-foreground"
						>
							已自动汇总配置、残值、实时三网延迟、流媒体解锁与回程路由（支持自由编辑）：
						</label>
						<textarea
							id={previewTextareaId}
							rows={13}
							value={editableMd}
							onChange={(e) => setEditableMd(e.target.value)}
							className="nz-thin-scroll w-full rounded-lg border border-border/70 bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:border-primary"
						/>
						<div className="flex justify-end">
							<button
								type="button"
								onClick={() => {
									navigator.clipboard
										.writeText(editableMd)
										.then(() =>
											toast.success("Markdown 测评卡片已复制到剪贴板！"),
										)
										.catch(() => toast.error("复制失败，请手动全选复制"));
								}}
								className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
							>
								<Copy className="h-3.5 w-3.5" />
								一键复制 Markdown
							</button>
						</div>
					</div>
				) : (
					<div className="space-y-3">
						<div className="overflow-hidden rounded-xl border border-border/70 bg-slate-950 p-2">
							<canvas ref={canvasRef} className="block w-full rounded-lg" />
						</div>
						<div className="flex justify-end">
							<button
								type="button"
								onClick={handleDownloadPng}
								className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
							>
								<Download className="h-3.5 w-3.5" />
								保存高清 PNG 海报
							</button>
						</div>
					</div>
				)}
			</div>
		</CustomModalDialog>
	);
}
