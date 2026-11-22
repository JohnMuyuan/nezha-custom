import type { PublicNoteData } from "@/lib/utils";
import type { NezhaServer } from "@/types/nezha-api";
import { parseServerBilling } from "./server-billing";
import { useThemeConfig } from "./theme-config";

export function RemainingValueBadge({
	server,
	parsedData,
}: {
	server: NezhaServer;
	parsedData?: PublicNoteData | null;
}) {
	const { remaining_value } = useThemeConfig();
	if (!remaining_value.enabled) return null;

	const billing = parseServerBilling(
		server,
		remaining_value.default_currency || "$",
		parsedData,
	);
	if (
		!billing ||
		billing.isFree ||
		billing.isOneTime ||
		billing.isNeverExpire ||
		billing.remainingValue === null
	) {
		return null;
	}

	const displayVal = billing.isExpired
		? `${billing.currencySymbol}0.00`
		: `${billing.currencySymbol}${billing.remainingValue.toFixed(2)}`;

	const daily = billing.price / billing.cycleDays;
	const tooltip = billing.isExpired
		? `已过期 VPS\n原价: ${billing.currencySymbol}${billing.price}/${billing.cycleLabel}`
		: `原价: ${billing.currencySymbol}${billing.price}/${billing.cycleLabel}\n剩余天数: ${billing.remainingDays ?? 0}天\n每日成本: ${billing.currencySymbol}${daily.toFixed(2)}/天\n剩余价值占比: ${billing.remainingRatio.toFixed(1)}%`;

	return (
		<p className={`nz-vps-value-tag ${billing.valueTier}`} title={tooltip}>
			{remaining_value.tag_text}
			{displayVal}
		</p>
	);
}
