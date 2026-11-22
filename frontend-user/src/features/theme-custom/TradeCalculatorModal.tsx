import { useQuery } from "@tanstack/react-query";
import { Copy, DollarSign, Edit2, ShoppingCart, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import type { NezhaServer } from "@/types/nezha-api";
import { CustomModalDialog } from "./CustomModalDialog";
import {
	fetchAllInspections,
	summarizeBackhaulRoutes,
	summarizeUnlockedMedia,
} from "./inspection-api";
import {
	CURRENCY_SYMBOLS,
	type CurrencyCode,
	convertToCNY,
	DEFAULT_EXCHANGE_RATES,
	fetchExchangeRates,
	formatLocalISODate,
	parseServerBilling,
} from "./server-billing";
import { useThemeConfig } from "./theme-config";

interface CompanionPricingState {
	checked: boolean;
	mode: "price" | "prem";
	currency: "CNY" | "USD" | "EUR";
	value: string;
}

interface CartCompanionItem {
	serverId: number;
	name: string;
	cost: string;
	expiry: string;
	rem: number;
	sell: number;
	prem: number;
	rateStr: string;
	rawMode: "price" | "prem";
	rawCur: "CNY" | "USD" | "EUR";
	rawVal: string;
}

interface SellCartItem {
	id: string;
	type: "sell";
	selectedServerId: string;
	mer: string;
	reg: string;
	bw: string;
	tr: string;
	rt: string;
	tm: string;
	nt: string;
	v4: boolean;
	v6: boolean;
	ali: boolean;
	pp: boolean;
	ppSafe: boolean;
	rawPrice: string;
	rawCur: CurrencyCode;
	rawCyc: string;
	rawExp: string;
	rawSell: string;
	rawSellCur: "CNY" | "USD" | "EUR";
	rawPremiumMode: boolean;
	isMulti: boolean;
	companions: CartCompanionItem[];
	pOrig: string;
	pExp: string;
	mainRem: number;
	mainSell: number;
	mainPrem: number;
	mainRateStr: string;
	accRem: number;
	accSell: number;
	accPrem: number;
}

interface BuyCartItem {
	id: string;
	type: "buy";
	mer: string;
	bVal: number;
	bCur: "CNY" | "USD" | "EUR";
	bIp: string;
	bUnl: string;
	bTim: string;
	bAcc: string;
	bMul: string;
	bNt: string;
	accSell: number;
}

type CartItem = SellCartItem | BuyCartItem;

const CYCLE_LABEL_MAP: Record<string, string> = {
	"365": "年付",
	"182.5": "半年付",
	"90": "季付",
	"30": "月付",
};

function calcRemainingCNY(
	priceOrig: number,
	currency: CurrencyCode,
	cycleDays: number,
	expiryDateStr: string,
	tradeDateStr: string,
	rates: Record<string, number>,
): number {
	if (
		!expiryDateStr ||
		!tradeDateStr ||
		!priceOrig ||
		Number.isNaN(priceOrig)
	) {
		return 0;
	}
	const pCNY = convertToCNY(priceOrig, currency, rates);
	const diffMs =
		new Date(`${expiryDateStr}T00:00:00+08:00`).getTime() -
		new Date(`${tradeDateStr}T00:00:00+08:00`).getTime();
	if (diffMs > 10 * 365 * 86_400_000) return pCNY;
	return diffMs > 0 ? (pCNY / cycleDays) * (diffMs / 86_400_000) : 0;
}

function formatMoney(val: number, cur: CurrencyCode): string {
	return `${CURRENCY_SYMBOLS[cur] || ""} ${val.toFixed(2)}`;
}

export function TradeCalculatorModal({
	open,
	onClose,
	servers,
}: {
	open: boolean;
	onClose: () => void;
	servers: NezhaServer[];
}) {
	const { trade_calc } = useThemeConfig();
	const titleId = useId();
	const fid = (name: string) => `${titleId}-${name}`;
	const [step, setStep] = useState<0 | 1 | 2>(0);
	const [mode, setMode] = useState<"sell" | "buy">("sell");
	const [rates, setRates] = useState<Record<string, number>>(
		DEFAULT_EXCHANGE_RATES,
	);
	const [ratesLive, setRatesLive] = useState(false);

	// Sell form states
	const [selectedServerId, setSelectedServerId] = useState("");
	const [price, setPrice] = useState("");
	const [currency, setCurrency] = useState<CurrencyCode>("CNY");
	const [cycle, setCycle] = useState("365");
	const [expiry, setExpiry] = useState("");
	const [tradeDate, setTradeDate] = useState(() =>
		formatLocalISODate(new Date()),
	);
	const [isPremiumMode, setIsPremiumMode] = useState(false);
	const [sellPrice, setSellPrice] = useState("");
	const [sellCurrency, setSellCurrency] = useState<"CNY" | "USD" | "EUR">(
		"CNY",
	);
	const [fMer, setFMer] = useState("");
	const [fReg, setFReg] = useState("");
	const [fBw, setFBw] = useState("");
	const [fTr, setFTr] = useState("");
	const [fRt, setFRt] = useState("");
	const [fTm, setFTm] = useState("Push");
	const [fV4, setFV4] = useState(false);
	const [fV6, setFV6] = useState(false);
	const [fAli, setFAli] = useState(false);
	const [fPp, setFPp] = useState(false);
	const [fPpSafe, setFPpSafe] = useState(false);
	const [fMulti, setFMulti] = useState(false);
	const [fNt, setFNt] = useState("");
	const [companionsMap, setCompanionsMap] = useState<
		Record<number, CompanionPricingState>
	>({});

	// Buy form states
	const [bMer, setBMer] = useState("");
	const [bCur, setBCur] = useState<"CNY" | "USD" | "EUR">("CNY");
	const [bBudget, setBBudget] = useState("");
	const [bIp, setBIp] = useState("无要求 (都可以)");
	const [bUnlock, setBUnlock] = useState("");
	const [bTime, setBTime] = useState("");
	const [bAcc, setBAcc] = useState("带原邮 / Push皆可");
	const [bMulti, setBMulti] = useState("不接受一号多机 (必须单号单机)");
	const [bNt, setBNt] = useState("");

	// Cart & Preview
	const [cart, setCart] = useState<CartItem[]>([]);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [gContact, setGContact] = useState(trade_calc.default_contact || "");
	const [gNote, setGNote] = useState(trade_calc.default_note || "");
	const [postContent, setPostContent] = useState("");

	useEffect(() => {
		setGContact(trade_calc.default_contact || "");
		setGNote(trade_calc.default_note || "");
	}, [trade_calc.default_contact, trade_calc.default_note]);

	useEffect(() => {
		if (!open) return;
		void fetchExchangeRates().then((r) => {
			setRates(r);
			setRatesLive(true);
		});
	}, [open]);

	const billingSig = servers
		.map((s) => `${s.id}:${s.name}:${s.public_note ?? ""}`)
		.join("|");

	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by billingSig so 1s WS ticks skip re-parsing
	const parsedServers = useMemo(() => {
		return servers
			.map((s) => parseServerBilling(s))
			.filter((b): b is NonNullable<typeof b> =>
				Boolean(b && !b.isFree && b.price > 0),
			);
	}, [billingSig]);

	// Real-time sell calculation
	const sellCalc = useMemo(() => {
		const pNum = Number.parseFloat(price);
		const cycNum = Number.parseFloat(cycle);
		const remCNY = calcRemainingCNY(
			pNum,
			currency,
			cycNum,
			expiry,
			tradeDate,
			rates,
		);
		const sNum = Number.parseFloat(sellPrice);
		if (Number.isNaN(pNum) || !expiry || !tradeDate) {
			return {
				remCNY: 0,
				sellCNY: null as number | null,
				premCNY: null as number | null,
				rate: 0,
			};
		}
		if (Number.isNaN(sNum)) {
			return { remCNY, sellCNY: null, premCNY: null, rate: 0 };
		}
		const sellCNY = isPremiumMode
			? remCNY + convertToCNY(sNum, sellCurrency, rates)
			: convertToCNY(sNum, sellCurrency, rates);
		const premCNY = sellCNY - remCNY;
		const rate = remCNY > 0 ? (premCNY / remCNY) * 100 : 0;
		return { remCNY, sellCNY, premCNY, rate };
	}, [
		price,
		currency,
		cycle,
		expiry,
		tradeDate,
		sellPrice,
		sellCurrency,
		isPremiumMode,
		rates,
	]);

	const { data: inspectionMap } = useQuery({
		queryKey: ["server-inspections"],
		queryFn: fetchAllInspections,
		enabled: open,
		staleTime: 60_000,
		retry: false,
	});

	const handleSelectSellServer = (val: string) => {
		setSelectedServerId(val);
		const found = parsedServers.find((s) => String(s.serverId) === val);
		if (!found) return;
		setPrice(String(found.price));
		setCurrency(found.currencyCode);
		setCycle(String(found.cycleDays));
		if (found.expiryDateStr) setExpiry(found.expiryDateStr);
		setFMer(
			`${found.merchant ? `${found.merchant} ` : ""}${found.serverName.split("(")[0].trim()}`,
		);
		setFReg(found.countryCode || "");
		setFBw(found.bandwidth || "");
		setFTr(found.trafficVol || "");
		const insp = inspectionMap?.[String(found.serverId)];
		const routeHint = summarizeBackhaulRoutes(insp);
		const unlockHint = summarizeUnlockedMedia(insp);
		setFRt(found.routing || routeHint || "无优化");
		if (unlockHint) {
			setFNt((prev) =>
				prev.includes("流媒体解锁") ? prev : `流媒体解锁: ${unlockHint}`,
			);
		}
		setFV4(found.ipv4);
		setFV6(found.ipv6);
	};

	const updateCompanion = (
		serverId: number,
		patch: Partial<CompanionPricingState>,
	) => {
		setCompanionsMap((prev) => ({
			...prev,
			[serverId]: {
				checked: prev[serverId]?.checked ?? false,
				mode: prev[serverId]?.mode ?? "price",
				currency: prev[serverId]?.currency ?? "CNY",
				value: prev[serverId]?.value ?? "",
				...patch,
			},
		}));
	};

	const buildSnapshot = (): CartItem | null => {
		if (mode === "buy") {
			if (!bMer.trim()) {
				toast.warning("请填写求购的【目标商家/型号】");
				return null;
			}
			const bVal = Number.parseFloat(bBudget);
			if (Number.isNaN(bVal) || bVal <= 0) {
				toast.warning("请填写您的【预算】金额");
				return null;
			}
			return {
				id: editingId || `cart_${Date.now()}`,
				type: "buy",
				mer: bMer.trim(),
				bVal,
				bCur,
				bIp,
				bUnl: bUnlock,
				bTim: bTime,
				bAcc,
				bMul: bMulti,
				bNt,
				accSell: convertToCNY(bVal, bCur, rates),
			};
		}

		if (!price) {
			toast.warning("请填写【购入原价】");
			return null;
		}
		if (!expiry) {
			toast.warning("请选择【到期时间】");
			return null;
		}
		if (!sellPrice || sellCalc.sellCNY === null || sellCalc.premCNY === null) {
			toast.warning("请填写【明盘价】或【溢价】");
			return null;
		}
		if (!fMer.trim()) {
			toast.warning("请填写【机器/商家名称】");
			return null;
		}

		const companions: CartCompanionItem[] = [];
		let totalCompRem = 0;
		let totalCompSell = 0;
		let totalCompPrem = 0;

		if (fMulti) {
			for (const srv of parsedServers) {
				if (String(srv.serverId) === selectedServerId) continue;
				const st = companionsMap[srv.serverId];
				if (!st?.checked) continue;
				const cRem = calcRemainingCNY(
					srv.price,
					srv.currencyCode,
					srv.cycleDays,
					srv.expiryDateStr,
					tradeDate,
					rates,
				);
				const valNum = Number.parseFloat(st.value) || 0;
				const valCNY = convertToCNY(valNum, st.currency, rates);
				const cSell = st.mode === "prem" ? cRem + valCNY : valCNY;
				const cPrem = cSell - cRem;
				const cRate = cRem > 0 ? ((cPrem / cRem) * 100).toFixed(2) : "0";
				totalCompRem += cRem;
				totalCompSell += cSell;
				totalCompPrem += cPrem;

				companions.push({
					serverId: srv.serverId,
					name: srv.serverName,
					cost: `${srv.price} ${srv.currencyCode}/${CYCLE_LABEL_MAP[String(srv.cycleDays)] || srv.cycleLabel}`,
					expiry: srv.expiryDateStr || "未知",
					rem: cRem,
					sell: cSell,
					prem: cPrem,
					rateStr:
						cPrem === 0
							? "平价出"
							: `溢价 ${cPrem > 0 ? "+" : ""}${cPrem.toFixed(2)} (${Number(cRate) > 0 ? "+" : ""}${cRate}%)`,
					rawMode: st.mode,
					rawCur: st.currency,
					rawVal: st.value,
				});
			}
		}

		const mRate =
			sellCalc.remCNY > 0
				? ((sellCalc.premCNY / sellCalc.remCNY) * 100).toFixed(2)
				: "0";
		return {
			id: editingId || `cart_${Date.now()}`,
			type: "sell",
			selectedServerId,
			mer: fMer.trim(),
			reg: fReg || "未说明",
			bw: fBw || "未说明",
			tr: fTr || "未说明",
			rt: fRt || "未说明",
			tm: fTm || "未说明",
			nt: fNt,
			v4: fV4,
			v6: fV6,
			ali: fAli,
			pp: fPp,
			ppSafe: fPpSafe,
			rawPrice: price,
			rawCur: currency,
			rawCyc: cycle,
			rawExp: expiry,
			rawSell: sellPrice,
			rawSellCur: sellCurrency,
			rawPremiumMode: isPremiumMode,
			isMulti: fMulti,
			companions,
			pOrig: `${price} ${currency} / ${CYCLE_LABEL_MAP[cycle] || "月付"}`,
			pExp: expiry,
			mainRem: sellCalc.remCNY,
			mainSell: sellCalc.sellCNY,
			mainPrem: sellCalc.premCNY,
			mainRateStr:
				sellCalc.premCNY === 0
					? "平价出"
					: `溢价 ${sellCalc.premCNY > 0 ? "+" : ""}${sellCalc.premCNY.toFixed(2)} (${Number(mRate) > 0 ? "+" : ""}${mRate}%)`,
			accRem: sellCalc.remCNY + totalCompRem,
			accSell: sellCalc.sellCNY + totalCompSell,
			accPrem: sellCalc.premCNY + totalCompPrem,
		};
	};

	const resetActiveForm = () => {
		if (mode === "buy") {
			setBMer("");
			setBBudget("");
			setBUnlock("");
			setBTime("");
			setBNt("");
		} else {
			setSelectedServerId("");
			setPrice("");
			setExpiry("");
			setSellPrice("");
			setFMer("");
			setFReg("");
			setFBw("");
			setFTr("");
			setFRt("");
			setFNt("");
			setFMulti(false);
			setCompanionsMap({});
		}
	};

	const handleAddCart = () => {
		const snap = buildSnapshot();
		if (!snap) return;
		setCart((prev) => [...prev, snap]);
		setEditingId(null);
		resetActiveForm();
		toast.success("已存入结算台");
	};

	const handleEditCartItem = (item: CartItem) => {
		setEditingId(item.id);
		setCart((prev) => prev.filter((i) => i.id !== item.id));
		if (item.type === "buy") {
			setMode("buy");
			setBMer(item.mer);
			setBCur(item.bCur);
			setBBudget(String(item.bVal));
			setBIp(item.bIp);
			setBUnlock(item.bUnl);
			setBTime(item.bTim);
			setBAcc(item.bAcc);
			setBMulti(item.bMul);
			setBNt(item.bNt);
		} else {
			setMode("sell");
			setSelectedServerId(item.selectedServerId);
			setPrice(item.rawPrice);
			setCurrency(item.rawCur);
			setCycle(item.rawCyc);
			setExpiry(item.rawExp);
			setSellPrice(item.rawSell);
			setSellCurrency(item.rawSellCur);
			setIsPremiumMode(item.rawPremiumMode);
			setFMer(item.mer);
			setFReg(item.reg === "未说明" ? "" : item.reg);
			setFBw(item.bw === "未说明" ? "" : item.bw);
			setFTr(item.tr === "未说明" ? "" : item.tr);
			setFRt(item.rt === "未说明" ? "" : item.rt);
			setFTm(item.tm === "未说明" ? "" : item.tm);
			setFNt(item.nt);
			setFV4(item.v4);
			setFV6(item.v6);
			setFAli(item.ali);
			setFPp(item.pp);
			setFPpSafe(item.ppSafe);
			setFMulti(item.isMulti);
			const nextMap: Record<number, CompanionPricingState> = {};
			for (const c of item.companions) {
				nextMap[c.serverId] = {
					checked: true,
					mode: c.rawMode,
					currency: c.rawCur,
					value: c.rawVal,
				};
			}
			setCompanionsMap(nextMap);
		}
		setStep(0);
		toast.info("已回档至表单，修改后请重新存入");
	};

	const generatePost = (targetType: "sell" | "buy") => {
		let items = cart.filter((i) => i.type === targetType);
		if (items.length === 0) {
			if (mode === targetType) {
				const snap = buildSnapshot();
				if (!snap) return;
				setCart((prev) => [...prev, snap]);
				items = [snap];
			} else {
				toast.warning(
					`暂存车中没有【${targetType === "sell" ? "出" : "收"}机】内容`,
				);
				return;
			}
		}

		const contact = gContact.trim() || "站内私信 / PM";
		const note = gNote.trim() || "支付宝口令红包或中介交易，中介费自理";
		let template = "";
		const titleParts: string[] = [];

		if (targetType === "sell") {
			let grandTot = 0;
			let grandPnl = 0;
			let bodyBlocks = "";

			(items as SellCartItem[]).forEach((acc, idx) => {
				grandTot += acc.accSell;
				grandPnl += acc.accPrem;
				let titlePart = `${acc.mer} [${acc.pOrig}]`;
				if (acc.isMulti && acc.companions.length > 0) {
					titlePart += ` + ${acc.companions.map((c) => `${c.name} [${c.cost}]`).join(" + ")}`;
				}
				titleParts.push(titlePart);

				const ipList = [acc.v4 ? "IPv4" : "", acc.v6 ? "IPv6" : ""].filter(
					Boolean,
				);
				const payList = [
					acc.ali ? "支付宝" : "",
					acc.pp ? `PayPal${acc.ppSafe ? "(已超半年防争议)" : ""}` : "",
				].filter(Boolean);
				const payFinal =
					payList.length > 0 ? ` (购入: ${payList.join("/")})` : "";
				const ntStr = acc.nt ? `\n- 其他说明：${acc.nt}` : "";

				bodyBlocks += `### ${idx + 1}. 账号主体：${acc.mer}\n**【基本参数】**\n- 节点配置：${acc.reg} | ${acc.bw} | ${acc.tr} | ${acc.rt}\n- IP 支持：${ipList.join("/") || "未说明"}\n- 购入成本：${acc.pOrig} (到期: ${acc.pExp})\n\n**【独立账单】**\n- 剩余价值：￥${acc.mainRem.toFixed(2)}\n- 本机明盘：**￥${acc.mainSell.toFixed(2)}** (${acc.mainRateStr})\n`;

				if (acc.isMulti && acc.companions.length > 0) {
					bodyBlocks += "\n**【同号伴生机】**\n";
					acc.companions.forEach((c, cIdx) => {
						bodyBlocks += `- 附加机 ${cIdx + 1}：${c.name}\n  续费：${c.cost} | 到期：${c.expiry} | 剩余价值：￥${c.rem.toFixed(2)}\n  本机明盘：**￥${c.sell.toFixed(2)}** (${c.rateStr})\n`;
					});
				}
				bodyBlocks += "\n**【本账号汇总】**\n";
				if (acc.isMulti)
					bodyBlocks += `- 账号总剩余：￥${acc.accRem.toFixed(2)}\n`;
				bodyBlocks += `- 账号总明盘：**￥${acc.accSell.toFixed(2)}** (账号总盈亏 ${acc.accPrem > 0 ? "+" : ""}${acc.accPrem.toFixed(2)})\n- 交易方式：${acc.tm}${payFinal}${ntStr}\n\n---\n\n`;
			});

			const baseRem = grandTot - grandPnl;
			const grandRate =
				baseRem > 0 ? ((grandPnl / baseRem) * 100).toFixed(2) : "0";
			const rateStr =
				grandPnl === 0
					? "平价"
					: `溢价 ${grandPnl > 0 ? "+" : ""}${grandPnl.toFixed(2)}, ${Number(grandRate) > 0 ? "+" : ""}${grandRate}%`;

			template = `【出】${titleParts.join(" + ")} | 总出价 ￥${grandTot.toFixed(2)} (${rateStr})\n\n${bodyBlocks}`;
			if (items.length > 1) {
				template += `**全部打包价格：** **￥${grandTot.toFixed(2)}** (${rateStr})\n\n`;
			}
		} else {
			let buyBlocks = "";
			let totalBudget = 0;
			(items as BuyCartItem[]).forEach((b, idx) => {
				totalBudget += b.accSell;
				titleParts.push(b.mer);
				const ntStr = b.bNt ? `\n- 备注说明：${b.bNt}` : "";
				buyBlocks += `### ${idx + 1}. 求购：${b.mer}\n- **我的预算**：**${formatMoney(b.bVal, b.bCur)}**\n- **线路/IP**：${b.bIp}\n- **解锁要求**：${b.bUnl || "无特殊要求"}\n- **到期要求**：${b.bTim || "无特殊要求"}\n- **交易方式**：${b.bAcc}\n- **多机接受度**：${b.bMul}${ntStr}\n\n---\n\n`;
			});
			template = `【收】${titleParts.join(" + ")} | 总预算 ￥${totalBudget.toFixed(2)}\n\n${buyBlocks}`;
		}

		setPostContent(
			`${template}**联系方式：** ${contact}\n**交易声明：** ${note}`,
		);
		setStep(2);
	};

	const sellItems = cart.filter((i): i is SellCartItem => i.type === "sell");
	const grandSellTot = sellItems.reduce((sum, i) => sum + i.accSell, 0);
	const grandSellPnl = sellItems.reduce((sum, i) => sum + i.accPrem, 0);

	const stepTitle =
		step === 0
			? editingId
				? "编辑回档数据..."
				: "交易与发帖助手"
			: step === 1
				? "结算台预收银"
				: "预览与修改";

	const inputCls =
		"h-9 w-full rounded-md border border-border/70 bg-muted/30 px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary";

	return (
		<CustomModalDialog
			open={open}
			onClose={() => {
				setStep(0);
				onClose();
			}}
			labelledBy={titleId}
			className="w-[95vw] max-w-[680px] h-[88dvh]"
		>
			{/* Header */}
			<div className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-3.5">
				<h2
					id={titleId}
					className="flex items-center gap-2 text-base font-bold text-primary"
				>
					<DollarSign className="h-4 w-4" />
					{stepTitle}
				</h2>
				<button
					type="button"
					aria-label="关闭交易助手"
					onClick={() => {
						setStep(0);
						onClose();
					}}
					className="rounded-md p-1 text-muted-foreground transition-transform hover:rotate-90 hover:text-foreground"
				>
					<X className="h-5 w-5" />
				</button>
			</div>

			{/* Sliding 3-step container */}
			<div className="relative flex-1 overflow-hidden">
				<div
					className="flex h-full w-[300%] transition-transform duration-300 ease-out"
					style={{ transform: `translateX(-${step * 33.3333}%)` }}
				>
					{/* STEP 0: FORM */}
					<div
						className="flex h-full w-1/3 flex-col"
						{...(step !== 0 ? ({ inert: "" } as Record<string, string>) : {})}
					>
						<div className="nz-thin-scroll flex-1 space-y-4 overflow-y-auto p-5">
							{/* Tabs */}
							<div className="flex rounded-lg bg-muted/50 p-1 text-sm font-bold">
								<button
									type="button"
									onClick={() => setMode("sell")}
									className={`flex-1 rounded-md py-2 transition-all ${
										mode === "sell"
											? "bg-card text-primary shadow-xs"
											: "text-muted-foreground hover:text-foreground"
									}`}
								>
									📤 闲置出机
								</button>
								<button
									type="button"
									onClick={() => setMode("buy")}
									className={`flex-1 rounded-md py-2 transition-all ${
										mode === "buy"
											? "bg-card text-primary shadow-xs"
											: "text-muted-foreground hover:text-foreground"
									}`}
								>
									📥 预算收机
								</button>
							</div>

							{mode === "sell" ? (
								<div className="space-y-3.5">
									<div>
										<label
											htmlFor={fid("sell-server")}
											className="mb-1 block text-xs font-semibold text-muted-foreground"
										>
											选择要出的机器
										</label>
										<select
											id={fid("sell-server")}
											value={selectedServerId}
											onChange={(e) => handleSelectSellServer(e.target.value)}
											className={`${inputCls} border-emerald-500/50 bg-emerald-500/5`}
										>
											<option value="">-- 手动填或从探针选择 --</option>
											{parsedServers.map((s) => (
												<option key={s.serverId} value={String(s.serverId)}>
													{s.serverName} ({s.currencyCode} {s.price})
												</option>
											))}
										</select>
									</div>

									<div>
										<label
											htmlFor={fid("sell-price-input")}
											className="mb-1 block text-xs font-semibold text-muted-foreground"
										>
											购入原价 <span className="text-red-500">*</span>
											{ratesLive && (
												<span className="ml-2 font-normal text-primary">
													(已应用实时汇率)
												</span>
											)}
										</label>
										<div className="flex gap-2">
											<select
												aria-label="原价币种"
												value={currency}
												onChange={(e) =>
													setCurrency(e.target.value as CurrencyCode)
												}
												className={`${inputCls} w-28 shrink-0`}
											>
												<option value="CNY">¥ CNY</option>
												<option value="USD">$ USD</option>
												<option value="HKD">$ HKD</option>
												<option value="EUR">€ EUR</option>
												<option value="GBP">£ GBP</option>
											</select>
											<input
												id={fid("sell-price-input")}
												type="number"
												step="0.01"
												min="0"
												placeholder="输入原价"
												value={price}
												onChange={(e) => setPrice(e.target.value)}
												className={inputCls}
											/>
										</div>
									</div>

									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										<div>
											<label
												htmlFor={fid("sell-cycle")}
												className="mb-1 block text-xs font-semibold text-muted-foreground"
											>
												计费周期
											</label>
											<select
												id={fid("sell-cycle")}
												value={cycle}
												onChange={(e) => setCycle(e.target.value)}
												className={inputCls}
											>
												<option value="365">年付 (365天)</option>
												<option value="182.5">半年付 (182.5天)</option>
												<option value="90">季付 (90天)</option>
												<option value="30">月付 (30天)</option>
											</select>
										</div>
										<div>
											<label
												htmlFor={fid("sell-expiry")}
												className="mb-1 block text-xs font-semibold text-muted-foreground"
											>
												到期时间 <span className="text-red-500">*</span>
											</label>
											<input
												id={fid("sell-expiry")}
												type="date"
												value={expiry}
												onChange={(e) => setExpiry(e.target.value)}
												className={inputCls}
											/>
										</div>
										<div>
											<label
												htmlFor={fid("sell-trade-date")}
												className="mb-1 block text-xs font-semibold text-muted-foreground"
											>
												当前交易日期
											</label>
											<input
												id={fid("sell-trade-date")}
												type="date"
												value={tradeDate}
												onChange={(e) => setTradeDate(e.target.value)}
												className={inputCls}
											/>
										</div>
										<div>
											<div className="mb-1 flex items-center justify-between">
												<label
													htmlFor={fid("sell-target-price")}
													className="text-xs font-semibold text-muted-foreground"
												>
													{isPremiumMode ? "本台期望溢价" : "本台明盘价"}{" "}
													<span className="text-red-500">*</span>
												</label>
												<button
													type="button"
													onClick={() => setIsPremiumMode((v) => !v)}
													className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
												>
													{isPremiumMode ? "切明盘" : "切溢价"}
												</button>
											</div>
											<div className="flex gap-1.5">
												<select
													aria-label="出机定价币种"
													value={sellCurrency}
													onChange={(e) =>
														setSellCurrency(
															e.target.value as "CNY" | "USD" | "EUR",
														)
													}
													className={`${inputCls} w-16 shrink-0 px-1.5`}
												>
													<option value="CNY">¥</option>
													<option value="USD">$</option>
													<option value="EUR">€</option>
												</select>
												<input
													id={fid("sell-target-price")}
													type="number"
													step="0.01"
													placeholder={
														isPremiumMode ? "正溢价/负折价" : "出机售价"
													}
													value={sellPrice}
													onChange={(e) => setSellPrice(e.target.value)}
													className={inputCls}
												/>
												<button
													type="button"
													onClick={() => {
														if (sellCalc.remCNY > 0) {
															setIsPremiumMode(false);
															setSellCurrency("CNY");
															setSellPrice(sellCalc.remCNY.toFixed(2));
														} else {
															toast.warning("请先填写原价和到期时间");
														}
													}}
													className="shrink-0 rounded-md border border-emerald-500/70 px-2 text-xs font-bold text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
												>
													⚡剩价出
												</button>
											</div>
										</div>
									</div>

									{/* Real-time Result Box */}
									<div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
										<div className="flex justify-between border-b border-dashed border-border/60 py-1.5">
											<span className="text-muted-foreground">剩余价值</span>
											<span className="font-mono font-bold text-primary">
												¥ {sellCalc.remCNY.toFixed(2)}
											</span>
										</div>
										<div className="flex justify-between border-b border-dashed border-border/60 py-1.5">
											<span className="text-muted-foreground">
												折合明盘售价
											</span>
											<span className="font-mono font-bold text-primary">
												{sellCalc.sellCNY !== null
													? `¥ ${sellCalc.sellCNY.toFixed(2)}`
													: "-"}
											</span>
										</div>
										<div className="flex justify-between pt-1.5">
											<span className="text-muted-foreground">
												折合盈亏占比
											</span>
											<span
												className={`font-mono font-bold ${
													sellCalc.premCNY === null
														? ""
														: sellCalc.premCNY > 0
															? "text-emerald-600 dark:text-emerald-400"
															: sellCalc.premCNY < 0
																? "text-red-500"
																: ""
												}`}
											>
												{sellCalc.premCNY !== null
													? `${sellCalc.premCNY > 0 ? "+" : ""}${sellCalc.premCNY.toFixed(2)} ${
															sellCalc.premCNY === 0
																? "(平价出)"
																: `(${sellCalc.rate > 0 ? "+" : ""}${sellCalc.rate.toFixed(2)}%)`
														}`
													: "-"}
											</span>
										</div>
									</div>

									{/* Post Parameters */}
									<div className="space-y-3 rounded-lg border border-border/60 bg-muted/15 p-3.5">
										<div className="flex items-center justify-between text-xs font-bold text-primary">
											<span>发帖参数区</span>
											<span className="font-normal text-muted-foreground">
												已智能提取，请核对
											</span>
										</div>
										<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
											<div>
												<label
													htmlFor={fid("sell-mer")}
													className="mb-1 block text-xs text-muted-foreground"
												>
													机器/商家 <span className="text-red-500">*</span>
												</label>
												<input
													id={fid("sell-mer")}
													value={fMer}
													onChange={(e) => setFMer(e.target.value)}
													placeholder="名称必填"
													className={inputCls}
												/>
											</div>
											<div>
												<label
													htmlFor={fid("sell-reg")}
													className="mb-1 block text-xs text-muted-foreground"
												>
													区域
												</label>
												<input
													id={fid("sell-reg")}
													value={fReg}
													onChange={(e) => setFReg(e.target.value)}
													placeholder="如 HK, US"
													className={inputCls}
												/>
											</div>
											<div>
												<label
													htmlFor={fid("sell-bw")}
													className="mb-1 block text-xs text-muted-foreground"
												>
													带宽
												</label>
												<input
													id={fid("sell-bw")}
													value={fBw}
													onChange={(e) => setFBw(e.target.value)}
													placeholder="如 1000Mbps"
													className={inputCls}
												/>
											</div>
											<div>
												<label
													htmlFor={fid("sell-tr")}
													className="mb-1 block text-xs text-muted-foreground"
												>
													流量
												</label>
												<input
													id={fid("sell-tr")}
													value={fTr}
													onChange={(e) => setFTr(e.target.value)}
													placeholder="如 无限流量"
													className={inputCls}
												/>
											</div>
											<div>
												<label
													htmlFor={fid("sell-rt")}
													className="mb-1 block text-xs text-muted-foreground"
												>
													线路
												</label>
												<input
													id={fid("sell-rt")}
													value={fRt}
													onChange={(e) => setFRt(e.target.value)}
													placeholder="如 CN2 GIA"
													className={inputCls}
												/>
											</div>
											<div>
												<label
													htmlFor={fid("sell-tm")}
													className="mb-1 block text-xs text-muted-foreground"
												>
													交易方式
												</label>
												<input
													id={fid("sell-tm")}
													value={fTm}
													onChange={(e) => setFTm(e.target.value)}
													placeholder="Push/带原邮"
													className={inputCls}
												/>
											</div>
										</div>

										<div className="flex flex-wrap gap-3 text-xs">
											<label className="flex cursor-pointer items-center gap-1.5">
												<input
													type="checkbox"
													checked={fV4}
													onChange={(e) => setFV4(e.target.checked)}
												/>
												IPv4
											</label>
											<label className="flex cursor-pointer items-center gap-1.5">
												<input
													type="checkbox"
													checked={fV6}
													onChange={(e) => setFV6(e.target.checked)}
												/>
												IPv6
											</label>
											<label className="flex cursor-pointer items-center gap-1.5 text-primary">
												<input
													type="checkbox"
													checked={fAli}
													onChange={(e) => {
														setFAli(e.target.checked);
														if (e.target.checked) setFPp(false);
													}}
												/>
												支付宝
											</label>
											<label className="flex cursor-pointer items-center gap-1.5 text-primary">
												<input
													type="checkbox"
													checked={fPp}
													onChange={(e) => {
														setFPp(e.target.checked);
														if (e.target.checked) setFAli(false);
													}}
												/>
												PayPal
											</label>
											<label className="flex cursor-pointer items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
												<input
													type="checkbox"
													checked={fMulti}
													onChange={(e) => setFMulti(e.target.checked)}
												/>
												含伴生机
											</label>
										</div>

										{fPp && (
											<div className="rounded border-l-2 border-primary bg-muted/40 p-2 text-xs">
												<label className="flex cursor-pointer items-center gap-1.5">
													<input
														type="checkbox"
														checked={fPpSafe}
														onChange={(e) => setFPpSafe(e.target.checked)}
													/>
													支付超半年（防争议）
												</label>
											</div>
										)}

										{fMulti && (
											<div className="space-y-2 rounded border-l-2 border-emerald-500 bg-muted/40 p-2.5 text-xs">
												<div className="text-muted-foreground">
													勾选同号伴生机并设置独立定价：
												</div>
												{parsedServers.length === 0 ? (
													<div className="text-muted-foreground">
														暂无其他机器
													</div>
												) : (
													parsedServers.map((srv) => {
														const isMain =
															String(srv.serverId) === selectedServerId;
														const st = companionsMap[srv.serverId] ?? {
															checked: false,
															mode: "price" as const,
															currency: "CNY" as const,
															value: "",
														};
														const cRem = calcRemainingCNY(
															srv.price,
															srv.currencyCode,
															srv.cycleDays,
															srv.expiryDateStr,
															tradeDate,
															rates,
														);
														const valNum = Number.parseFloat(st.value);
														const valCNY = Number.isNaN(valNum)
															? null
															: convertToCNY(valNum, st.currency, rates);
														const cSell =
															valCNY === null
																? null
																: st.mode === "prem"
																	? cRem + valCNY
																	: valCNY;
														const cPrem = cSell === null ? null : cSell - cRem;

														return (
															<div
																key={srv.serverId}
																className="space-y-1.5 border-b border-dashed border-border/60 pb-2 last:border-none last:pb-0"
															>
																<label className="flex cursor-pointer items-center gap-1.5 font-medium">
																	<input
																		type="checkbox"
																		disabled={isMain}
																		checked={isMain || st.checked}
																		onChange={(e) =>
																			updateCompanion(srv.serverId, {
																				checked: e.target.checked,
																			})
																		}
																	/>
																	<span>{srv.serverName}</span>
																</label>
																{!isMain && st.checked && (
																	<div className="flex gap-1.5 pl-4">
																		<select
																			value={st.mode}
																			onChange={(e) =>
																				updateCompanion(srv.serverId, {
																					mode: e.target.value as
																						| "price"
																						| "prem",
																				})
																			}
																			className="h-7 rounded border border-border bg-background px-1.5 text-xs"
																		>
																			<option value="price">售价</option>
																			<option value="prem">溢价</option>
																		</select>
																		<select
																			value={st.currency}
																			onChange={(e) =>
																				updateCompanion(srv.serverId, {
																					currency: e.target.value as
																						| "CNY"
																						| "USD"
																						| "EUR",
																				})
																			}
																			className="h-7 rounded border border-border bg-background px-1.5 text-xs"
																		>
																			<option value="CNY">¥</option>
																			<option value="USD">$</option>
																			<option value="EUR">€</option>
																		</select>
																		<input
																			type="number"
																			placeholder="金额"
																			value={st.value}
																			onChange={(e) =>
																				updateCompanion(srv.serverId, {
																					value: e.target.value,
																				})
																			}
																			className="h-7 flex-1 rounded border border-border bg-background px-2 text-xs"
																		/>
																		<button
																			type="button"
																			onClick={() =>
																				updateCompanion(srv.serverId, {
																					mode: "prem",
																					currency: "CNY",
																					value: "0",
																				})
																			}
																			className="rounded bg-muted px-2 text-[11px] font-semibold hover:bg-primary hover:text-primary-foreground"
																		>
																			⚡剩价出
																		</button>
																	</div>
																)}
																<div className="pl-4 text-[11px] text-muted-foreground">
																	剩余: ¥ {cRem.toFixed(2)} | 折合明盘:{" "}
																	{isMain ? (
																		<b className="text-primary">
																			主机器(见上方)
																		</b>
																	) : cSell !== null ? (
																		`¥ ${cSell.toFixed(2)}`
																	) : (
																		"-"
																	)}{" "}
																	| 盈亏:{" "}
																	{!isMain && cPrem !== null ? (
																		<b
																			className={
																				cPrem > 0
																					? "text-emerald-500"
																					: cPrem < 0
																						? "text-red-500"
																						: ""
																			}
																		>
																			{cPrem > 0 ? "+" : ""}
																			{cPrem.toFixed(2)}
																		</b>
																	) : (
																		"-"
																	)}
																</div>
															</div>
														);
													})
												)}
											</div>
										)}

										<input
											value={fNt}
											onChange={(e) => setFNt(e.target.value)}
											placeholder="自定义备注说明（选填）"
											className={inputCls}
										/>
									</div>
								</div>
							) : (
								/* BUY MODE */
								<div className="space-y-3 rounded-lg border border-border/60 bg-muted/15 p-3.5">
									<div className="text-xs font-bold text-primary">
										📥 求购要求定制
									</div>
									<div>
										<label
											htmlFor={fid("buy-quick")}
											className="mb-1 block text-xs text-muted-foreground"
										>
											快捷导入（从探针展示服务器中选）
										</label>
										<select
											id={fid("buy-quick")}
											value=""
											onChange={(e) => {
												if (e.target.value) setBMer(e.target.value);
											}}
											className={`${inputCls} border-emerald-500/50 bg-emerald-500/5`}
										>
											<option value="">-- 手动填或点此快捷选择 --</option>
											{servers.map((s) => (
												<option key={s.id} value={s.name}>
													{s.name}
												</option>
											))}
										</select>
									</div>
									<div>
										<label
											htmlFor={fid("buy-mer")}
											className="mb-1 block text-xs text-muted-foreground"
										>
											目标商家/型号 <span className="text-red-500">*</span>
										</label>
										<input
											id={fid("buy-mer")}
											value={bMer}
											onChange={(e) => setBMer(e.target.value)}
											placeholder="如：搬瓦工 DC9 / 斯巴达 36刀"
											className={inputCls}
										/>
									</div>
									<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
										<div>
											<label
												htmlFor={fid("buy-budget")}
												className="mb-1 block text-xs text-muted-foreground"
											>
												我的预算 <span className="text-red-500">*</span>
											</label>
											<div className="flex gap-1.5">
												<select
													aria-label="预算币种"
													value={bCur}
													onChange={(e) =>
														setBCur(e.target.value as "CNY" | "USD" | "EUR")
													}
													className={`${inputCls} w-16 shrink-0 px-1.5`}
												>
													<option value="CNY">¥</option>
													<option value="USD">$</option>
													<option value="EUR">€</option>
												</select>
												<input
													id={fid("buy-budget")}
													type="number"
													value={bBudget}
													onChange={(e) => setBBudget(e.target.value)}
													placeholder="最高接受价格"
													className={inputCls}
												/>
											</div>
										</div>
										<div>
											<label
												htmlFor={fid("buy-ip")}
												className="mb-1 block text-xs text-muted-foreground"
											>
												IP 状态要求
											</label>
											<select
												id={fid("buy-ip")}
												value={bIp}
												onChange={(e) => setBIp(e.target.value)}
												className={inputCls}
											>
												<option value="无要求 (都可以)">无要求 (都可以)</option>
												<option value="必须干净正常">必须干净正常</option>
												<option value="被墙也可">被墙也可</option>
												<option value="特定段(见备注)">特定段(见备注)</option>
											</select>
										</div>
										<div>
											<label
												htmlFor={fid("buy-unlock")}
												className="mb-1 block text-xs text-muted-foreground"
											>
												流媒体/解锁
											</label>
											<input
												id={fid("buy-unlock")}
												value={bUnlock}
												onChange={(e) => setBUnlock(e.target.value)}
												placeholder="如 必解 Netflix"
												className={inputCls}
											/>
										</div>
										<div>
											<label
												htmlFor={fid("buy-time")}
												className="mb-1 block text-xs text-muted-foreground"
											>
												到期时间要求
											</label>
											<input
												id={fid("buy-time")}
												value={bTime}
												onChange={(e) => setBTime(e.target.value)}
												placeholder="如 剩余>3个月"
												className={inputCls}
											/>
										</div>
									</div>
									<div>
										<label
											htmlFor={fid("buy-acc")}
											className="mb-1 block text-xs text-muted-foreground"
										>
											交易方式要求
										</label>
										<input
											id={fid("buy-acc")}
											value={bAcc}
											onChange={(e) => setBAcc(e.target.value)}
											className={inputCls}
										/>
									</div>
									<div>
										<label
											htmlFor={fid("buy-multi")}
											className="mb-1 block text-xs text-muted-foreground"
										>
											多机处理
										</label>
										<select
											id={fid("buy-multi")}
											value={bMulti}
											onChange={(e) => setBMulti(e.target.value)}
											className={inputCls}
										>
											<option value="不接受一号多机 (必须单号单机)">
												不接受一号多机 (必须单号单机)
											</option>
											<option value="可接受伴生机 (视伴生价值而定)">
												可接受伴生机 (视伴生价值而定)
											</option>
										</select>
									</div>
									<div>
										<label
											htmlFor={fid("buy-note")}
											className="mb-1 block text-xs text-muted-foreground"
										>
											补充说明
										</label>
										<input
											id={fid("buy-note")}
											value={bNt}
											onChange={(e) => setBNt(e.target.value)}
											placeholder="如：只要黑五款、特定节点优先"
											className={inputCls}
										/>
									</div>
								</div>
							)}
						</div>

						<div className="flex shrink-0 gap-2.5 border-t border-border/60 p-4">
							<button
								type="button"
								onClick={handleAddCart}
								className="flex-1 rounded-lg border border-dashed border-primary py-2.5 text-sm font-semibold text-primary hover:bg-primary/5"
							>
								+ 存入暂存车
							</button>
							<button
								type="button"
								onClick={() => setStep(1)}
								className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/50 py-2.5 text-sm font-semibold hover:bg-muted"
							>
								<ShoppingCart className="h-4 w-4" />
								前往结算台 ({cart.length})
							</button>
						</div>
					</div>

					{/* STEP 1: CART */}
					<div
						className="flex h-full w-1/3 flex-col"
						{...(step !== 1 ? ({ inert: "" } as Record<string, string>) : {})}
					>
						<div className="nz-thin-scroll flex flex-1 flex-col gap-3 overflow-y-auto p-5">
							{cart.length === 0 ? (
								<div className="py-16 text-center text-sm text-muted-foreground">
									暂存车为空
									<br />
									<span className="text-xs">
										请在左侧表单配置并加入，或直接点击生成
									</span>
								</div>
							) : (
								<>
									{cart.map((item, idx) => (
										<div
											key={item.id}
											className="rounded-lg border border-border/70 bg-muted/25 p-3.5 text-xs"
										>
											<div className="mb-2 flex items-center justify-between border-b border-border/50 pb-2 text-sm font-bold text-primary">
												<span>
													{idx + 1}.{" "}
													<span
														className={`mr-1 rounded px-1.5 py-0.5 text-[11px] text-white ${
															item.type === "buy"
																? "bg-emerald-600"
																: "bg-primary text-primary-foreground"
														}`}
													>
														{item.type === "buy" ? "收" : "出"}
													</span>
													{item.mer}
												</span>
											</div>
											{item.type === "buy" ? (
												<div className="flex justify-between text-muted-foreground">
													<span>求购预算</span>
													<b className="text-foreground">
														{formatMoney(item.bVal, item.bCur)}
													</b>
												</div>
											) : (
												<div className="space-y-1 text-muted-foreground">
													<div className="flex justify-between">
														<span>主机器盈亏</span>
														<b
															className={
																item.mainPrem > 0
																	? "text-emerald-500"
																	: item.mainPrem < 0
																		? "text-red-500"
																		: ""
															}
														>
															{item.mainPrem > 0 ? "+" : ""}
															{item.mainPrem.toFixed(2)}
														</b>
													</div>
													{item.companions.length > 0 && (
														<div className="my-1.5 space-y-1 border-l-2 border-border pl-2.5">
															{item.companions.map((c) => (
																<div
																	key={c.serverId}
																	className="flex justify-between"
																>
																	<span>↳ {c.name}</span>
																	<span>
																		明盘 ¥{c.sell.toFixed(2)} (
																		<b
																			className={
																				c.prem > 0
																					? "text-emerald-500"
																					: c.prem < 0
																						? "text-red-500"
																						: ""
																			}
																		>
																			{c.prem > 0 ? "+" : ""}
																			{c.prem.toFixed(2)}
																		</b>
																		)
																	</span>
																</div>
															))}
														</div>
													)}
													<div className="flex justify-between pt-1 font-bold text-foreground">
														<span>本单总明盘</span>
														<span>¥ {item.accSell.toFixed(2)}</span>
													</div>
													<div className="flex justify-between font-bold text-foreground">
														<span>本单总盈亏</span>
														<span
															className={
																item.accPrem > 0
																	? "text-emerald-500"
																	: item.accPrem < 0
																		? "text-red-500"
																		: ""
															}
														>
															{item.accPrem > 0 ? "+" : ""}
															{item.accPrem.toFixed(2)}
														</span>
													</div>
												</div>
											)}
											<div className="mt-2.5 flex justify-end gap-3">
												<button
													type="button"
													onClick={() => handleEditCartItem(item)}
													className="flex items-center gap-1 text-primary hover:opacity-75"
												>
													<Edit2 className="h-3.5 w-3.5" />
													编辑
												</button>
												<button
													type="button"
													onClick={() =>
														setCart((prev) =>
															prev.filter((i) => i.id !== item.id),
														)
													}
													className="flex items-center gap-1 text-destructive hover:opacity-75"
												>
													<Trash2 className="h-3.5 w-3.5" />
													移除
												</button>
											</div>
										</div>
									))}

									{sellItems.length > 0 && (
										<div
											className={`mt-auto rounded-lg border p-3.5 text-sm font-bold ${
												grandSellPnl > 0
													? "border-emerald-500/60 bg-emerald-500/10"
													: grandSellPnl < 0
														? "border-red-500/60 bg-red-500/10"
														: "border-border bg-muted/30"
											}`}
										>
											<div className="flex justify-between">
												<span>出机总明盘：</span>
												<span>¥ {grandSellTot.toFixed(2)}</span>
											</div>
											<div className="mt-1 flex justify-between">
												<span>出机总盈亏：</span>
												<span
													className={
														grandSellPnl > 0
															? "text-emerald-600 dark:text-emerald-400"
															: grandSellPnl < 0
																? "text-red-500"
																: ""
													}
												>
													{grandSellPnl > 0 ? "+" : ""}
													{grandSellPnl.toFixed(2)}
												</span>
											</div>
										</div>
									)}
								</>
							)}
						</div>

						<div className="shrink-0 space-y-2.5 border-t border-border/60 p-4">
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								<input
									value={gContact}
									onChange={(e) => setGContact(e.target.value)}
									placeholder="留空默认: 站内私信 / PM"
									className={inputCls}
								/>
								<input
									value={gNote}
									onChange={(e) => setGNote(e.target.value)}
									placeholder="留空默认: 支付宝/中介费自理"
									className={inputCls}
								/>
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => setStep(0)}
									className="rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm font-semibold hover:bg-muted"
								>
									返回
								</button>
								<button
									type="button"
									onClick={() => generatePost("sell")}
									className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
								>
									生成出机帖
								</button>
								<button
									type="button"
									onClick={() => generatePost("buy")}
									className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
								>
									生成收机帖
								</button>
							</div>
						</div>
					</div>

					{/* STEP 2: PREVIEW */}
					<div
						className="flex h-full w-1/3 flex-col"
						{...(step !== 2 ? ({ inert: "" } as Record<string, string>) : {})}
					>
						<div className="flex flex-1 flex-col gap-2.5 p-5">
							<label
								htmlFor={fid("post-preview")}
								className="text-xs font-bold text-muted-foreground"
							>
								📝 预览并自由编辑 Markdown 帖子内容：
							</label>
							<textarea
								id={fid("post-preview")}
								value={postContent}
								onChange={(e) => setPostContent(e.target.value)}
								className="nz-thin-scroll flex-1 resize-none rounded-lg border border-border/70 bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:border-primary"
							/>
						</div>
						<div className="flex shrink-0 gap-2 border-t border-border/60 p-4">
							<button
								type="button"
								onClick={() => setStep(1)}
								className="rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm font-semibold hover:bg-muted"
							>
								上一步
							</button>
							<button
								type="button"
								onClick={() => {
									navigator.clipboard
										.writeText(postContent)
										.then(() => toast.success("帖子内容已复制到剪贴板！"))
										.catch(() => toast.error("复制失败，请手动全选复制"));
								}}
								className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
							>
								<Copy className="h-4 w-4" />
								复制并发帖
							</button>
						</div>
					</div>
				</div>
			</div>
		</CustomModalDialog>
	);
}
