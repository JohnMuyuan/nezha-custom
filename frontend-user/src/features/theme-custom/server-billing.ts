import {
	getDaysBetweenDatesWithAutoRenewal,
	type PublicNoteData,
	parsePublicNote,
} from "@/lib/utils";
import type { CycleTransferStats, NezhaServer } from "@/types/nezha-api";

export type CurrencyCode = "CNY" | "USD" | "HKD" | "EUR" | "GBP";

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
	CNY: "￥",
	USD: "$",
	HKD: "HK$",
	EUR: "€",
	GBP: "£",
};

export const DEFAULT_EXCHANGE_RATES: Record<CurrencyCode, number> = {
	CNY: 1,
	USD: 0.14,
	HKD: 1.08,
	EUR: 0.13,
	GBP: 0.11,
};

let cachedRates: Record<string, number> | null = null;
let cachedRatesTs = 0;

export async function fetchExchangeRates(): Promise<Record<string, number>> {
	const now = Date.now();
	if (cachedRates && now - cachedRatesTs < 30 * 60 * 1000) {
		return cachedRates;
	}
	try {
		const res = await fetch("https://open.er-api.com/v6/latest/CNY", {
			signal: AbortSignal.timeout(5000),
		});
		if (res.ok) {
			const data = (await res.json()) as { rates?: Record<string, number> };
			if (data?.rates) {
				cachedRates = data.rates;
				cachedRatesTs = now;
				return data.rates;
			}
		}
	} catch {
		// Fall back to static default rates
	}
	return cachedRates ?? DEFAULT_EXCHANGE_RATES;
}

export function convertToCNY(
	value: number,
	currency: string,
	rates: Record<string, number>,
): number {
	if (!Number.isFinite(value) || value === 0) return 0;
	if (currency === "CNY" || !rates[currency]) return value;
	return value / rates[currency];
}

export type BillingPeriodType = "month" | "quarter" | "half-year" | "year";

export interface ParsedServerBilling {
	serverId: number;
	serverName: string;
	countryCode: string;
	price: number;
	currencyCode: CurrencyCode;
	currencySymbol: string;
	period: BillingPeriodType;
	cycleDays: number;
	cycleLabel: string;
	isFree: boolean;
	isOneTime: boolean;
	isNeverExpire: boolean;
	isExpired: boolean;
	remainingDays: number | null; // null if no expiry date
	expiryDateStr: string; // YYYY-MM-DD
	remainingValue: number | null; // in original currency
	remainingRatio: number; // 0..100
	valueTier: "excellent" | "good" | "moderate" | "low" | "very-low" | "expired";
	bandwidth: string;
	trafficVol: string;
	ipv4: boolean;
	ipv6: boolean;
	routing: string;
	merchant: string;
	autoRenewal: boolean;
}

const KNOWN_SYMBOL_LIST: Array<{
	match: RegExp;
	code: CurrencyCode;
	sym: string;
}> = [
	{ match: /HK\$|HKD/i, code: "HKD", sym: "HK$" },
	{ match: /US\$|\$|USD/i, code: "USD", sym: "$" },
	{ match: /€|EUR/i, code: "EUR", sym: "€" },
	{ match: /£|GBP/i, code: "GBP", sym: "£" },
	{ match: /¥|￥|CNY|RMB/i, code: "CNY", sym: "￥" },
];

export function normalizePeriod(cycleRaw: string): {
	period: BillingPeriodType;
	cycleDays: number;
	cycleLabel: string;
} {
	const c = (cycleRaw || "").trim().toLowerCase();
	if (/年|yr|year|annual|y\b/.test(c)) {
		return { period: "year", cycleDays: 365, cycleLabel: "年" };
	}
	if (/半年|half|semi|h\b/.test(c)) {
		return { period: "half-year", cycleDays: 182.5, cycleLabel: "半年" };
	}
	if (/季|quarter|qr|q\b/.test(c)) {
		return { period: "quarter", cycleDays: 90, cycleLabel: "季" };
	}
	return { period: "month", cycleDays: 30, cycleLabel: "月" };
}

export function getValueTier(
	remaining: number,
	original: number,
): ParsedServerBilling["valueTier"] {
	if (remaining <= 0) return "expired";
	const ratio = original > 0 ? (remaining / original) * 100 : 0;
	if (ratio > 75) return "excellent";
	if (ratio > 50) return "good";
	if (ratio > 25) return "moderate";
	if (ratio > 10) return "low";
	return "very-low";
}

export function parseCurrencyAndAmount(
	amountStr: string,
	fallbackSymbol = "$",
): { value: number; currencyCode: CurrencyCode; currencySymbol: string } {
	const cleaned = (amountStr || "").trim();
	let currencyCode: CurrencyCode =
		fallbackSymbol === "￥" || fallbackSymbol === "¥"
			? "CNY"
			: fallbackSymbol === "€"
				? "EUR"
				: fallbackSymbol === "£"
					? "GBP"
					: fallbackSymbol === "HK$"
						? "HKD"
						: "USD";
	let currencySymbol = fallbackSymbol || "$";

	for (const entry of KNOWN_SYMBOL_LIST) {
		if (entry.match.test(cleaned)) {
			currencyCode = entry.code;
			currencySymbol = entry.sym;
			break;
		}
	}

	const numMatch = cleaned.replace(/,/g, "").match(/[\d.]+/);
	const value = numMatch ? Number.parseFloat(numMatch[0]) : 0;
	return {
		value: Number.isFinite(value) ? value : 0,
		currencyCode,
		currencySymbol,
	};
}

export function parseServerBilling(
	server: NezhaServer,
	defaultCurrencySymbol = "$",
	preParsed?: PublicNoteData | null,
): ParsedServerBilling | null {
	const parsed =
		preParsed !== undefined ? preParsed : parsePublicNote(server.public_note);
	const billing = parsed?.billingDataMod;
	const plan = parsed?.planDataMod;

	if (!billing && !plan) return null;

	const amountRaw = billing?.amount?.trim() || "";
	const cycleRaw = billing?.cycle?.trim() || "";
	const isOneTime = cycleRaw === "-" || /一次性|one.?time/i.test(cycleRaw);
	const isFree =
		!amountRaw ||
		amountRaw === "0" ||
		amountRaw === "-1" ||
		/^(免费|free|白嫖)$/i.test(amountRaw) ||
		server.name.includes("白嫖");

	const { value, currencyCode, currencySymbol } = parseCurrencyAndAmount(
		amountRaw,
		defaultCurrencySymbol,
	);
	const { period, cycleDays, cycleLabel } = normalizePeriod(cycleRaw);

	let isNeverExpire = false;
	let isExpired = false;
	let remainingDays: number | null = null;
	let expiryDateStr = "";

	if (billing?.endDate) {
		if (billing.endDate.startsWith("0000-00-00")) {
			isNeverExpire = true;
		} else {
			try {
				const res = getDaysBetweenDatesWithAutoRenewal(billing);
				remainingDays = res.days;
				isExpired = res.days < 0;
				const targetDate = new Date();
				targetDate.setHours(0, 0, 0, 0);
				targetDate.setDate(targetDate.getDate() + res.days);
				expiryDateStr = formatLocalISODate(targetDate);
			} catch {
				// Invalid date in public_note
			}
		}
	}

	let remainingValue: number | null = null;
	let remainingRatio = 0;
	let valueTier: ParsedServerBilling["valueTier"] = "expired";

	if (!isFree && !isOneTime && value > 0) {
		if (isExpired) {
			remainingValue = 0;
			remainingRatio = 0;
			valueTier = "expired";
		} else if (isNeverExpire) {
			remainingValue = value;
			remainingRatio = 100;
			valueTier = "excellent";
		} else if (remainingDays !== null && remainingDays >= 0) {
			remainingValue = (value / cycleDays) * remainingDays;
			remainingRatio = value > 0 ? (remainingValue / value) * 100 : 0;
			valueTier = getValueTier(remainingValue, value);
		}
	}

	const extras = (plan?.extra || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const merchant = extras.length > 0 ? extras[extras.length - 1] : "";

	return {
		serverId: server.id,
		serverName: server.name,
		countryCode: (server.country_code || "").toUpperCase(),
		price: isFree ? 0 : value,
		currencyCode,
		currencySymbol,
		period,
		cycleDays,
		cycleLabel,
		isFree,
		isOneTime,
		isNeverExpire,
		isExpired,
		remainingDays,
		expiryDateStr,
		remainingValue,
		remainingRatio,
		valueTier,
		bandwidth: plan?.bandwidth || "",
		trafficVol: plan?.trafficVol || "",
		ipv4: plan?.IPv4 === "1",
		ipv6: plan?.IPv6 === "1",
		routing: plan?.networkRoute || "",
		merchant,
		autoRenewal: billing?.autoRenewal === "1",
	};
}

export function formatLocalISODate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export interface ServerCycleTraffic {
	cycleId: string;
	cycleName: string;
	serverId: string;
	serverName: string;
	transfer: number; // bytes
	max: number; // bytes
	from: string;
	to: string;
}

const cycleTrafficMapCache = new WeakMap<
	CycleTransferStats,
	Map<number, ServerCycleTraffic>
>();

export function extractCycleTrafficMap(
	cycleStats?: CycleTransferStats | null,
): Map<number, ServerCycleTraffic> {
	if (!cycleStats) return new Map<number, ServerCycleTraffic>();
	const cached = cycleTrafficMapCache.get(cycleStats);
	if (cached) return cached;

	const map = new Map<number, ServerCycleTraffic>();

	for (const [cycleId, cycle] of Object.entries(cycleStats)) {
		if (!cycle?.server_name || !cycle?.transfer) continue;
		for (const [serverIdStr, serverName] of Object.entries(cycle.server_name)) {
			const transfer = cycle.transfer[serverIdStr];
			const max =
				typeof cycle.max === "object" && cycle.max !== null
					? cycle.max[serverIdStr]
					: cycle.max;
			const from =
				typeof cycle.from === "object" && cycle.from !== null
					? cycle.from[serverIdStr]
					: cycle.from;
			const to =
				typeof cycle.to === "object" && cycle.to !== null
					? cycle.to[serverIdStr]
					: cycle.to;

			if (
				serverName &&
				transfer !== undefined &&
				typeof max === "number" &&
				max > 0 &&
				typeof from === "string" &&
				typeof to === "string"
			) {
				const numId = Number(serverIdStr);
				if (Number.isFinite(numId)) {
					map.set(numId, {
						cycleId,
						cycleName: cycle.name || "",
						serverId: serverIdStr,
						serverName,
						transfer,
						max,
						from,
						to,
					});
				}
			}
		}
	}
	cycleTrafficMapCache.set(cycleStats, map);
	return map;
}

export function formatFileSizeParts(bytes: number): {
	value: string;
	unit: string;
} {
	if (!bytes || bytes <= 0) return { value: "0", unit: "B" };
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let size = bytes;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex += 1;
	}
	return {
		value: size.toFixed(unitIndex === 0 ? 0 : 2),
		unit: units[unitIndex],
	};
}

export function formatGB(gb: number): string {
	if (!Number.isFinite(gb) || gb <= 0) return "0 GB";
	if (gb >= 1024 * 1024) return `${(gb / (1024 * 1024)).toFixed(2)} PB`;
	if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
	if (gb >= 1) return `${gb.toFixed(2)} GB`;
	return `${(gb * 1024).toFixed(2)} MB`;
}

export function getTrafficGradientColor(percentage: number): string {
	const p = Math.min(Math.max(Number(percentage) || 0, 0), 100);
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	let h: number;
	let s: number;
	let l: number;

	if (p <= 35) {
		const t = p / 35;
		h = lerp(142, 32, t);
		s = lerp(69, 85, t);
		l = lerp(45, 55, t);
	} else if (p <= 85) {
		const t = (p - 35) / 50;
		h = lerp(32, 0, t);
		s = lerp(85, 75, t);
		l = lerp(55, 50, t);
	} else {
		const t = (p - 85) / 15;
		h = 0;
		s = 75;
		l = lerp(50, 45, t);
	}
	return `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
}

export function calculateRemainingDaysUntil(dateString: string): number {
	const target = new Date(dateString);
	if (Number.isNaN(target.getTime())) return 0;
	const now = new Date();
	target.setHours(0, 0, 0, 0);
	now.setHours(0, 0, 0, 0);
	const diffDays = Math.ceil(
		(target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
	);
	return diffDays > 0 ? diffDays : 0;
}

export function formatShortDate(dateString: string): string {
	const date = new Date(dateString);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleDateString("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
}
