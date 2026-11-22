export interface MediaCheckItem {
	platform: string;
	name: string;
	category: "streaming" | "ai" | string;
	status:
		| "full"
		| "yes"
		| "originals"
		| "web"
		| "cn"
		| "no"
		| "na"
		| "error"
		| string;
	region?: string;
	note?: string;
}

export interface MediaUnlockReport {
	ipv4_available: boolean;
	ipv6_available: boolean;
	ipv4: MediaCheckItem[];
	ipv6?: MediaCheckItem[];
	checked_at: string;
}

export interface BackhaulRouteItem {
	isp: "ct" | "cu" | "cm" | string;
	isp_label: string;
	target: string;
	route_type: string;
	tier: "premium" | "good" | "standard" | "unknown" | string;
	hops?: string[];
	latency_ms?: number;
}

export interface BackhaulReport {
	tool?: string;
	routes: BackhaulRouteItem[];
	checked_at: string;
}

export interface IPQualityReport {
	ip?: string;
	asn?: string;
	org?: string;
	isp?: string;
	country?: string;
	region?: string;
	city?: string;
	ip_type?: "residential" | "datacenter" | "mobile" | "unknown" | string;
	risk_level?: "low" | "medium" | "high" | "unknown" | string;
	is_datacenter?: boolean;
	is_proxy?: boolean;
	is_vpn?: boolean;
	is_tor?: boolean;
	is_abuser?: boolean;
	google_region?: string;
	google_cn?: boolean;
	smtp_25_open?: boolean;
	dnsbl_clean?: boolean;
	dnsbl_listed?: string[];
	checked_at: string;
}

export interface ServerInspectionPayload {
	server_id: number;
	running: boolean;
	media?: MediaUnlockReport;
	backhaul?: BackhaulReport;
	ip_quality?: IPQualityReport;
	last_error?: string;
	updated_at?: string;
}

export interface InspectionSummary {
	server_id: number;
	running: boolean;
	unlocked?: Record<string, string>;
	regions?: Record<string, string>;
	routes?: Record<string, string>;
	ip_type?: string;
	google_cn?: boolean;
	smtp_25_open?: boolean;
	updated_at?: string;
}

function readCsrfCookie(): string {
	if (typeof document === "undefined") return "";
	const match = document.cookie
		.split("; ")
		.find((part) => part.startsWith("nz-csrf="));
	return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : "";
}

export async function fetchAllInspections(): Promise<
	Record<string, InspectionSummary>
> {
	const res = await fetch("/api/v1/inspections", {
		credentials: "same-origin",
	});
	if (!res.ok) return {};
	const json = (await res.json()) as {
		success?: boolean;
		data?: Record<string, InspectionSummary>;
	};
	return json?.data ?? {};
}

export async function fetchServerInspection(
	serverId: number,
): Promise<ServerInspectionPayload> {
	const res = await fetch(`/api/v1/server/${serverId}/inspection`, {
		credentials: "same-origin",
	});
	if (!res.ok) {
		return { server_id: serverId, running: false };
	}
	const json = (await res.json()) as {
		success?: boolean;
		data?: ServerInspectionPayload;
	};
	return json?.data ?? { server_id: serverId, running: false };
}

export async function triggerServerInspection(
	serverId: number,
	scopes?: string[],
): Promise<{ server_id: number; started: boolean }> {
	const csrf = readCsrfCookie();
	const res = await fetch(`/api/v1/inspections/${serverId}/run`, {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"Content-Type": "application/json",
			...(csrf ? { "X-CSRF-Token": csrf } : {}),
		},
		body: JSON.stringify({ scopes }),
	});
	const json = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		error?: string;
		data?: { server_id: number; started: boolean };
	};
	if (!res.ok || json.success === false) {
		throw new Error(json.error || `HTTP ${res.status}`);
	}
	return json.data ?? { server_id: serverId, started: true };
}

export function isUnlockedStatus(status?: string): boolean {
	return (
		status === "full" ||
		status === "yes" ||
		status === "originals" ||
		status === "web"
	);
}

export function summarizeUnlockedMedia(
	summary?: InspectionSummary | null,
): string {
	if (!summary?.unlocked) return "";
	const labels: Record<string, string> = {
		netflix: "Netflix",
		disney: "Disney+",
		youtube: "YouTube",
		tiktok: "TikTok",
		spotify: "Spotify",
		prime: "Prime",
		hbo: "HBO",
		bilibili: "Bilibili",
		chatgpt: "ChatGPT",
		claude: "Claude",
		gemini: "Gemini",
	};
	const hits: string[] = [];
	for (const [plat, status] of Object.entries(summary.unlocked)) {
		if (!isUnlockedStatus(status)) continue;
		const reg = summary.regions?.[plat];
		const base = labels[plat] || plat;
		if (status === "originals") hits.push(`${base}(自制)`);
		else if (status === "web") hits.push(`${base}(Web)`);
		else hits.push(reg ? `${base}(${reg})` : base);
	}
	return hits.join(" / ");
}

export function summarizeBackhaulRoutes(
	summary?: InspectionSummary | null,
): string {
	if (!summary?.routes) return "";
	const parts: string[] = [];
	if (summary.routes.ct) parts.push(`电信${summary.routes.ct}`);
	if (summary.routes.cu) parts.push(`联通${summary.routes.cu}`);
	if (summary.routes.cm) parts.push(`移动${summary.routes.cm}`);
	return parts.join(" / ");
}
