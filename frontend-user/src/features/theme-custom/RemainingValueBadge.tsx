import { memo, useMemo } from "react";
import type { PublicNoteData } from "@/lib/utils";
import type { NezhaServer } from "@/types/nezha-api";
import { parseServerBilling } from "./server-billing";
import { useThemeConfig } from "./theme-config";

export const RemainingValueBadge = memo(
	function RemainingValueBadge({
		server,
		parsedData,
	}: {
		server: NezhaServer;
		parsedData?: PublicNoteData | null;
	}) {
		const { remaining_value } = useThemeConfig();

		// Memoize strictly on billing-relevant primitives so live CPU/RAM WS ticks never re-parse
		const { id, name, country_code, public_note } = server;
		const billing = useMemo(() => {
			if (!remaining_value.enabled) return null;
			return parseServerBilling(
				{ id, name, country_code, public_note } as NezhaServer,
				remaining_value.default_currency || "$",
				parsedData,
			);
		}, [
			remaining_value.enabled,
			remaining_value.default_currency,
			id,
			name,
			country_code,
			public_note,
			parsedData,
		]);

		if (
			!remaining_value.enabled ||
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
	},
	(prev, next) =>
		prev.server.id === next.server.id &&
		prev.server.name === next.server.name &&
		prev.server.public_note === next.server.public_note &&
		prev.parsedData === next.parsedData,
);
