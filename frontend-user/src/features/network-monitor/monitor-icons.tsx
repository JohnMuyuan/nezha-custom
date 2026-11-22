import { hasFlag } from "country-flag-icons";
import { Activity, Globe } from "lucide-react";
import akamaiIcon from "@/assets/isp-icons/akamai.svg";
import alibabaCloudIcon from "@/assets/isp-icons/alibabacloud.svg";
import attIcon from "@/assets/isp-icons/att.svg";
import awsIcon from "@/assets/isp-icons/aws.svg";
import azureIcon from "@/assets/isp-icons/azure.svg";
import btIcon from "@/assets/isp-icons/bt.svg";
import chinaBroadnetIcon from "@/assets/isp-icons/chinabroadnet.svg";
import chinaMobileIcon from "@/assets/isp-icons/chinamobile.svg";
import chinaTelecomIcon from "@/assets/isp-icons/chinatelecom.svg";
import chinaUnicomIcon from "@/assets/isp-icons/chinaunicom.svg";
import cloudflareIcon from "@/assets/isp-icons/cloudflare.svg";
import digitalOceanIcon from "@/assets/isp-icons/digitalocean.svg";
import googleIcon from "@/assets/isp-icons/google.svg";
import hetznerIcon from "@/assets/isp-icons/hetzner.svg";
import huaweiIcon from "@/assets/isp-icons/huawei.svg";
import linodeIcon from "@/assets/isp-icons/linode.svg";
import nttIcon from "@/assets/isp-icons/ntt.svg";
import oracleIcon from "@/assets/isp-icons/oracle.svg";
import orangeIcon from "@/assets/isp-icons/orange.svg";
import ovhIcon from "@/assets/isp-icons/ovh.svg";
import softbankIcon from "@/assets/isp-icons/softbank.svg";
import telekomIcon from "@/assets/isp-icons/telekom.svg";
import telstraIcon from "@/assets/isp-icons/telstra.svg";
import tencentCloudIcon from "@/assets/isp-icons/tencentcloud.svg";
import tmobileIcon from "@/assets/isp-icons/tmobile.svg";
import verizonIcon from "@/assets/isp-icons/verizon.svg";
import vodafoneIcon from "@/assets/isp-icons/vodafone.svg";
import vultrIcon from "@/assets/isp-icons/vultr.svg";
import { cn } from "@/lib/utils";

export interface MonitorBrandInfo {
	id: string;
	label: string;
	iconSrc?: string;
	monogram?: string;
	accentColor: string;
	/** Whether dark mode benefits from a crisp subtle light chip behind dark strokes/fills */
	preferLightChip?: boolean;
	category: "cn-carrier" | "overseas-carrier" | "cloud";
}

export interface MonitorMeta {
	brand: MonitorBrandInfo | null;
	countryCode: string | null;
	ipStack: "IPv4" | "IPv6" | null;
	routeTag: string | null;
	isDomesticCarrier: boolean;
}

interface BrandRule {
	brand: MonitorBrandInfo;
	pattern: RegExp;
	impliedCountry?: string;
}

const BRAND_RULES: BrandRule[] = [
	// Chinese domestic carriers (highest priority for three-network probes)
	{
		brand: {
			id: "chinatelecom",
			label: "中国电信",
			iconSrc: chinaTelecomIcon,
			accentColor: "#0066CC",
			category: "cn-carrier",
		},
		pattern:
			/电信|chinanet|ctnet|china\s*telecom|\btelecom\b|\bct\b|cn2\s*gia|cn2\s*gt|\bcn2\b|163|天翼/i,
	},
	{
		brand: {
			id: "chinaunicom",
			label: "中国联通",
			iconSrc: chinaUnicomIcon,
			accentColor: "#E60012",
			category: "cn-carrier",
		},
		pattern: /联通|china\s*unicom|\bunicom\b|\bcu\b|\bcucc\b|9929|4837|10099/i,
	},
	{
		brand: {
			id: "chinamobile",
			label: "中国移动",
			iconSrc: chinaMobileIcon,
			accentColor: "#0085D0",
			category: "cn-carrier",
		},
		pattern: /移动|china\s*mobile|\bcmcc\b|\bcm\b|cmin2|\bcmi\b|\bmobile\b/i,
	},
	{
		brand: {
			id: "chinabroadnet",
			label: "中国广电",
			iconSrc: chinaBroadnetIcon,
			accentColor: "#D9232E",
			category: "cn-carrier",
		},
		pattern: /广电|broadnet|\bcbn\b/i,
	},
	{
		brand: {
			id: "cernet",
			label: "教育网",
			monogram: "EDU",
			accentColor: "#2563EB",
			category: "cn-carrier",
		},
		pattern: /教育网|cernet|科技网|cstnet/i,
	},

	// Major global cloud / CDN / VPS networks
	{
		brand: {
			id: "cloudflare",
			label: "Cloudflare",
			iconSrc: cloudflareIcon,
			accentColor: "#F38020",
			category: "cloud",
		},
		pattern: /cloudflare|\bcf\b|1\.1\.1\.1/i,
	},
	{
		brand: {
			id: "google",
			label: "Google",
			iconSrc: googleIcon,
			accentColor: "#4285F4",
			category: "cloud",
		},
		pattern: /google|\bgcp\b|谷歌|8\.8\.8\.8/i,
	},
	{
		brand: {
			id: "aws",
			label: "AWS",
			iconSrc: awsIcon,
			accentColor: "#FF9900",
			preferLightChip: true,
			category: "cloud",
		},
		pattern: /\baws\b|amazon|lightsail|亚马逊/i,
	},
	{
		brand: {
			id: "azure",
			label: "Azure",
			iconSrc: azureIcon,
			accentColor: "#0078D4",
			category: "cloud",
		},
		pattern: /azure|microsoft|微软/i,
	},
	{
		brand: {
			id: "oracle",
			label: "Oracle",
			iconSrc: oracleIcon,
			accentColor: "#F80000",
			category: "cloud",
		},
		pattern: /oracle|\boci\b|甲骨文/i,
	},
	{
		brand: {
			id: "alibabacloud",
			label: "阿里云",
			iconSrc: alibabaCloudIcon,
			accentColor: "#FF6A00",
			category: "cloud",
		},
		pattern: /阿里云|aliyun|alibaba/i,
	},
	{
		brand: {
			id: "tencentcloud",
			label: "腾讯云",
			iconSrc: tencentCloudIcon,
			accentColor: "#00A4FF",
			category: "cloud",
		},
		pattern: /腾讯云|tencent|qcloud/i,
	},
	{
		brand: {
			id: "huawei",
			label: "华为云",
			iconSrc: huaweiIcon,
			accentColor: "#CF0A2C",
			category: "cloud",
		},
		pattern: /华为|huawei/i,
	},
	{
		brand: {
			id: "hetzner",
			label: "Hetzner",
			iconSrc: hetznerIcon,
			accentColor: "#D50C2D",
			category: "cloud",
		},
		pattern: /hetzner/i,
		impliedCountry: "DE",
	},
	{
		brand: {
			id: "ovh",
			label: "OVHcloud",
			iconSrc: ovhIcon,
			accentColor: "#0050D7",
			preferLightChip: true,
			category: "cloud",
		},
		pattern: /\bovh\b|ovhcloud/i,
		impliedCountry: "FR",
	},
	{
		brand: {
			id: "digitalocean",
			label: "DigitalOcean",
			iconSrc: digitalOceanIcon,
			accentColor: "#0080FF",
			category: "cloud",
		},
		pattern: /digital\s*ocean/i,
	},
	{
		brand: {
			id: "vultr",
			label: "Vultr",
			iconSrc: vultrIcon,
			accentColor: "#007BFC",
			category: "cloud",
		},
		pattern: /vultr/i,
	},
	{
		brand: {
			id: "linode",
			label: "Linode",
			iconSrc: linodeIcon,
			accentColor: "#00A95C",
			category: "cloud",
		},
		pattern: /linode/i,
	},
	{
		brand: {
			id: "akamai",
			label: "Akamai",
			iconSrc: akamaiIcon,
			accentColor: "#0096D6",
			category: "cloud",
		},
		pattern: /akamai/i,
	},

	// Overseas telecom carriers
	{
		brand: {
			id: "ntt",
			label: "NTT",
			iconSrc: nttIcon,
			accentColor: "#0072BC",
			category: "overseas-carrier",
		},
		pattern: /\bntt\b|docomo/i,
		impliedCountry: "JP",
	},
	{
		brand: {
			id: "softbank",
			label: "SoftBank",
			iconSrc: softbankIcon,
			accentColor: "#64748B",
			category: "overseas-carrier",
		},
		pattern: /softbank|软银|bbtec/i,
		impliedCountry: "JP",
	},
	{
		brand: {
			id: "att",
			label: "AT&T",
			iconSrc: attIcon,
			accentColor: "#00A8E0",
			category: "overseas-carrier",
		},
		pattern: /at&t|\batt\b/i,
		impliedCountry: "US",
	},
	{
		brand: {
			id: "verizon",
			label: "Verizon",
			iconSrc: verizonIcon,
			accentColor: "#CD040B",
			category: "overseas-carrier",
		},
		pattern: /verizon/i,
		impliedCountry: "US",
	},
	{
		brand: {
			id: "tmobile",
			label: "T-Mobile",
			iconSrc: tmobileIcon,
			accentColor: "#E20074",
			category: "overseas-carrier",
		},
		pattern: /t-?mobile/i,
	},
	{
		brand: {
			id: "telekom",
			label: "Deutsche Telekom",
			iconSrc: telekomIcon,
			accentColor: "#E20074",
			category: "overseas-carrier",
		},
		pattern: /德国电信|deutsche\s*telekom|\bdtag\b|\btelekom\b/i,
		impliedCountry: "DE",
	},
	{
		brand: {
			id: "vodafone",
			label: "Vodafone",
			iconSrc: vodafoneIcon,
			accentColor: "#E60000",
			category: "overseas-carrier",
		},
		pattern: /vodafone|沃达丰/i,
	},
	{
		brand: {
			id: "orange",
			label: "Orange",
			iconSrc: orangeIcon,
			accentColor: "#FF7900",
			category: "overseas-carrier",
		},
		pattern: /\borange\b/i,
		impliedCountry: "FR",
	},
	{
		brand: {
			id: "bt",
			label: "BT",
			iconSrc: btIcon,
			accentColor: "#6400AA",
			category: "overseas-carrier",
		},
		pattern: /british\s*telecom|btnet|\bbt\b/i,
		impliedCountry: "GB",
	},
	{
		brand: {
			id: "telstra",
			label: "Telstra",
			iconSrc: telstraIcon,
			accentColor: "#0064D2",
			category: "overseas-carrier",
		},
		pattern: /telstra|澳洲电信/i,
		impliedCountry: "AU",
	},
	{
		brand: {
			id: "pccw",
			label: "PCCW / HKT",
			monogram: "HKT",
			accentColor: "#0EA5E9",
			category: "overseas-carrier",
		},
		pattern: /\bpccw\b|\bhkt\b|电讯盈科|香港电讯/i,
		impliedCountry: "HK",
	},
	{
		brand: {
			id: "hgc",
			label: "HGC",
			monogram: "HGC",
			accentColor: "#F97316",
			category: "overseas-carrier",
		},
		pattern: /\bhgc\b|和记/i,
		impliedCountry: "HK",
	},
	{
		brand: {
			id: "hinet",
			label: "中华电信",
			monogram: "CHT",
			accentColor: "#0284C7",
			category: "overseas-carrier",
		},
		pattern: /中华电信|hinet|\bcht\b|chunghwa/i,
		impliedCountry: "TW",
	},
	{
		brand: {
			id: "singtel",
			label: "Singtel",
			monogram: "ST",
			accentColor: "#EF4444",
			category: "overseas-carrier",
		},
		pattern: /singtel|新电信/i,
		impliedCountry: "SG",
	},
	{
		brand: {
			id: "kddi",
			label: "KDDI",
			monogram: "KDDI",
			accentColor: "#0F4C81",
			category: "overseas-carrier",
		},
		pattern: /\bkddi\b/i,
		impliedCountry: "JP",
	},
	{
		brand: {
			id: "iij",
			label: "IIJ",
			monogram: "IIJ",
			accentColor: "#1D4ED8",
			category: "overseas-carrier",
		},
		pattern: /\biij\b/i,
		impliedCountry: "JP",
	},
	{
		brand: {
			id: "cogent",
			label: "Cogent",
			monogram: "COG",
			accentColor: "#0369A1",
			category: "overseas-carrier",
		},
		pattern: /cogent/i,
	},
	{
		brand: {
			id: "he",
			label: "Hurricane Electric",
			monogram: "HE",
			accentColor: "#2563EB",
			category: "overseas-carrier",
		},
		pattern: /hurricane|\bhe\.net\b/i,
	},
	{
		brand: {
			id: "telia",
			label: "Arelion / Telia",
			monogram: "TEL",
			accentColor: "#7C3AED",
			category: "overseas-carrier",
		},
		pattern: /telia|arelion/i,
	},
	{
		brand: {
			id: "lumen",
			label: "Lumen",
			monogram: "LMN",
			accentColor: "#0284C7",
			category: "overseas-carrier",
		},
		pattern: /lumen|level3/i,
	},
];

// Comprehensive overseas region / country / city dictionary -> ISO 3166-1 alpha-2
const REGION_RULES: Array<{ code: string; pattern: RegExp }> = [
	{
		code: "HK",
		pattern: /香港|荃湾|沙田|九龙|葵涌|将军澳|港岛|hong\s*kong|\bhk\b|\bhkg\b/i,
	},
	{ code: "MO", pattern: /澳门|macau|macao|\bmo\b/i },
	{
		code: "TW",
		pattern: /台湾|台北|高雄|台中|彰化|新竹|taiwan|taipei|\btw\b|\btpe\b/i,
	},
	{
		code: "US",
		pattern:
			/美国|美西|美东|洛杉矶|圣何塞|西雅图|纽约|达拉斯|芝加哥|迈阿密|硅谷|旧金山|凤凰城|拉斯维加斯|盐湖城|华盛顿|阿什本|亚特兰大|united\s*states|\busa\b|\bus\b|los\s*angeles|\blax\b|san\s*jose|\bsjc\b|seattle|\bsea\b|new\s*york|\bnyc\b|dallas|miami|chicago|ashburn|silicon\s*valley|fremont/i,
	},
	{
		code: "GB",
		pattern:
			/英国|伦敦|曼彻斯特|英格兰|united\s*kingdom|britain|london|\buk\b|\bgb\b|\blhr\b/i,
	},
	{
		code: "JP",
		pattern:
			/日本|东京|大阪|福冈|名古屋|札幌|冲绳|japan|tokyo|osaka|\bjp\b|\btyo\b|\bnrt\b|\bkix\b/i,
	},
	{ code: "SG", pattern: /新加坡|狮城|singapore|\bsg\b|\bsin\b/i },
	{
		code: "KR",
		pattern: /韩国|首尔|釜山|仁川|春川|korea|seoul|\bkr\b|\bicn\b/i,
	},
	{
		code: "DE",
		pattern:
			/德国|法兰克福|柏林|慕尼黑|纽伦堡|法尔肯施泰因|germany|frankfurt|berlin|munich|nuremberg|\bde\b|\bfra\b/i,
	},
	{
		code: "NL",
		pattern: /荷兰|阿姆斯特丹|鹿特丹|netherlands|amsterdam|\bnl\b|\bams\b/i,
	},
	{ code: "FR", pattern: /法国|巴黎|马赛|里昂|france|paris|\bfr\b|\bcdg\b/i },
	{
		code: "CA",
		pattern:
			/加拿大|多伦多|温哥华|蒙特利尔|canada|toronto|vancouver|montreal|\bca\b/i,
	},
	{
		code: "AU",
		pattern:
			/澳大利亚|澳洲|悉尼|墨尔本|珀斯|布里斯班|australia|sydney|melbourne|\bau\b|\bsyd\b/i,
	},
	{
		code: "RU",
		pattern:
			/俄罗斯|莫斯科|圣彼得堡|伯力|海参崴|西伯利亚|新西伯利亚|russia|moscow|\bru\b/i,
	},
	{
		code: "MY",
		pattern: /马来西亚|大马|吉隆坡|新山|malaysia|kuala\s*lumpur|\bmy\b/i,
	},
	{ code: "TH", pattern: /泰国|曼谷|thailand|bangkok|\bth\b/i },
	{ code: "VN", pattern: /越南|胡志明|河内|vietnam|hanoi|\bvn\b/i },
	{ code: "PH", pattern: /菲律宾|马尼拉|philippines|manila|\bph\b/i },
	{ code: "ID", pattern: /印度尼西亚|印尼|雅加达|indonesia|jakarta/i },
	{ code: "IN", pattern: /印度|孟买|班加罗尔|新德里|india|mumbai|bangalore/i },
	{ code: "TR", pattern: /土耳其|伊斯坦布尔|turkey|istanbul|\btr\b/i },
	{ code: "CH", pattern: /瑞士|苏黎世|日内瓦|switzerland|zurich|\bch\b/i },
	{ code: "SE", pattern: /瑞典|斯德哥尔摩|sweden|stockholm|\bse\b/i },
	{ code: "FI", pattern: /芬兰|赫尔辛基|finland|helsinki|\bfi\b/i },
	{ code: "NO", pattern: /挪威|奥斯陆|norway|oslo/i },
	{ code: "DK", pattern: /丹麦|哥本哈根|denmark|copenhagen|\bdk\b/i },
	{ code: "IT", pattern: /意大利|米兰|罗马|italy|milan|rome/i },
	{ code: "ES", pattern: /西班牙|马德里|巴塞罗那|spain|madrid|\bes\b/i },
	{ code: "PT", pattern: /葡萄牙|里斯本|portugal|lisbon|\bpt\b/i },
	{ code: "PL", pattern: /波兰|华沙|poland|warsaw|\bpl\b/i },
	{ code: "LU", pattern: /卢森堡|luxembourg|\blu\b/i },
	{ code: "IE", pattern: /爱尔兰|都柏林|ireland|dublin|\bie\b/i },
	{ code: "AT", pattern: /奥地利|维也纳|austria|vienna/i },
	{ code: "BE", pattern: /比利时|布鲁塞尔|belgium|brussels/i },
	{ code: "CZ", pattern: /捷克|布拉格|czech|prague|\bcz\b/i },
	{ code: "RO", pattern: /罗马尼亚|布加勒斯特|romania|bucharest|\bro\b/i },
	{ code: "BG", pattern: /保加利亚|索非亚|bulgaria|sofia|\bbg\b/i },
	{ code: "UA", pattern: /乌克兰|基辅|ukraine|kyiv|\bua\b/i },
	{ code: "GR", pattern: /希腊|雅典|greece|athens|\bgr\b/i },
	{ code: "BR", pattern: /巴西|圣保罗|brazil|sao\s*paulo|\bbr\b/i },
	{ code: "MX", pattern: /墨西哥|mexico|\bmx\b/i },
	{ code: "AR", pattern: /阿根廷|argentina|\bar\b/i },
	{ code: "CL", pattern: /智利|圣地亚哥|chile|\bcl\b/i },
	{ code: "AE", pattern: /阿联酋|迪拜|阿布扎比|dubai|\buae\b|\bae\b/i },
	{ code: "IL", pattern: /以色列|特拉维夫|israel|\bil\b/i },
	{ code: "ZA", pattern: /南非|约翰内斯堡|south\s*africa|\bza\b/i },
	{ code: "NZ", pattern: /新西兰|奥克兰|new\s*zealand|auckland|\bnz\b/i },
	{
		code: "CN",
		pattern:
			/中国|大陆|北京|上海|广州|深圳|杭州|成都|重庆|武汉|南京|天津|西安|苏州|江苏|浙江|广东|福建|山东|河南|河北|湖南|湖北|四川|辽宁|吉林|黑龙江|镇江|无锡|扬州|宁波|厦门|青岛|大连|\bcn\b/i,
	},
];

const ROUTE_RULES: Array<{ tag: string; pattern: RegExp }> = [
	{ tag: "CN2 GIA", pattern: /cn2\s*gia|\bgia\b/i },
	{ tag: "CN2 GT", pattern: /cn2\s*gt/i },
	{ tag: "CN2", pattern: /\bcn2\b/i },
	{ tag: "AS9929", pattern: /9929/i },
	{ tag: "AS4837", pattern: /4837/i },
	{ tag: "CMIN2", pattern: /cmin2/i },
	{ tag: "CMI", pattern: /\bcmi\b/i },
	{ tag: "IPLC", pattern: /iplc/i },
	{ tag: "IEPL", pattern: /iepl/i },
	{ tag: "BGP", pattern: /\bbgp\b/i },
];

export function detectMonitorMeta(name: string): MonitorMeta {
	const raw = (name || "").trim();

	let matchedBrand: MonitorBrandInfo | null = null;
	let impliedCountry: string | null = null;
	for (const rule of BRAND_RULES) {
		if (rule.pattern.test(raw)) {
			matchedBrand = rule.brand;
			if (rule.impliedCountry) impliedCountry = rule.impliedCountry;
			break;
		}
	}

	let countryCode: string | null = null;
	for (const rule of REGION_RULES) {
		if (rule.pattern.test(raw)) {
			countryCode = rule.code;
			break;
		}
	}
	if (!countryCode && impliedCountry) {
		countryCode = impliedCountry;
	}

	let ipStack: "IPv4" | "IPv6" | null = null;
	if (/(?:^|[\s|/\-_([（])(?:ipv6|v6)(?:$|[\s|/\-_)）\]])/i.test(raw)) {
		ipStack = "IPv6";
	} else if (/(?:^|[\s|/\-_([（])(?:ipv4|v4)(?:$|[\s|/\-_)）\]])/i.test(raw)) {
		ipStack = "IPv4";
	}

	let routeTag: string | null = null;
	for (const rule of ROUTE_RULES) {
		if (rule.pattern.test(raw)) {
			routeTag = rule.tag;
			break;
		}
	}

	return {
		brand: matchedBrand,
		countryCode,
		ipStack,
		routeTag,
		isDomesticCarrier: matchedBrand?.category === "cn-carrier",
	};
}

export interface LatencyHealth {
	tier: "excellent" | "good" | "fair" | "poor" | "none";
	bars: 0 | 1 | 2 | 3 | 4;
	textClass: string;
	barClass: string;
	label: string;
}

export function getLatencyHealth(
	delayMs: number | null | undefined,
): LatencyHealth {
	if (delayMs == null || Number.isNaN(delayMs)) {
		return {
			tier: "none",
			bars: 0,
			textClass: "text-muted-foreground",
			barClass: "bg-muted-foreground/30",
			label: "暂无样本",
		};
	}
	if (delayMs < 80) {
		return {
			tier: "excellent",
			bars: 4,
			textClass: "text-emerald-600 dark:text-emerald-400",
			barClass: "bg-emerald-500",
			label: "极佳",
		};
	}
	if (delayMs < 160) {
		return {
			tier: "good",
			bars: 3,
			textClass: "text-sky-600 dark:text-sky-400",
			barClass: "bg-sky-500",
			label: "良好",
		};
	}
	if (delayMs < 260) {
		return {
			tier: "fair",
			bars: 2,
			textClass: "text-amber-600 dark:text-amber-400",
			barClass: "bg-amber-500",
			label: "一般",
		};
	}
	return {
		tier: "poor",
		bars: 1,
		textClass: "text-rose-600 dark:text-rose-400",
		barClass: "bg-rose-500",
		label: "偏高",
	};
}

export function MonitorIdentityBadge({
	meta,
	seriesColor,
	size = "md",
}: {
	meta: MonitorMeta;
	seriesColor: string;
	size?: "sm" | "md";
}) {
	const isSm = size === "sm";
	const boxCls = isSm
		? "relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
		: "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/95 shadow-xs dark:bg-neutral-900/90";

	const validFlag =
		meta.countryCode && hasFlag(meta.countryCode.toUpperCase())
			? meta.countryCode.toLowerCase()
			: null;

	// Case 1: Official Carrier / Cloud SVG Brand Icon (optionally with corner flag for overseas nodes)
	if (meta.brand?.iconSrc) {
		const showCornerFlag =
			!isSm && validFlag && !meta.isDomesticCarrier && validFlag !== "cn";
		return (
			<span
				aria-hidden="true"
				className={cn(boxCls, meta.brand.preferLightChip && "dark:bg-white/92")}
			>
				<img
					src={meta.brand.iconSrc}
					alt=""
					width={isSm ? 14 : 22}
					height={isSm ? 14 : 22}
					decoding="async"
					className={cn(
						"object-contain select-none",
						isSm ? "h-3.5 w-3.5" : "h-5.5 w-5.5",
					)}
				/>
				{showCornerFlag && (
					<span
						className={cn(
							"fi fis absolute -right-1 -bottom-1 rounded-full ring-2 ring-card",
							`fi-${validFlag}`,
						)}
						style={{ width: 14, height: 14, backgroundSize: "cover" }}
					/>
				)}
			</span>
		);
	}

	// Case 2: Monogram Carrier (PCCW/HKT, HGC, CHT, Singtel, KDDI, CERNET...)
	if (meta.brand?.monogram) {
		const showCornerFlag = !isSm && validFlag && validFlag !== "cn";
		return (
			<span
				aria-hidden="true"
				className={cn(
					boxCls,
					"font-mono font-bold tracking-tighter text-white",
					isSm ? "text-[8px]" : "text-[10px]",
				)}
				style={{ backgroundColor: meta.brand.accentColor }}
			>
				{meta.brand.monogram}
				{showCornerFlag && (
					<span
						className={cn(
							"fi fis absolute -right-1 -bottom-1 rounded-full ring-2 ring-card",
							`fi-${validFlag}`,
						)}
						style={{ width: 14, height: 14, backgroundSize: "cover" }}
					/>
				)}
			</span>
		);
	}

	// Case 3: Overseas / Regional Node Flag (e.g. 美国 | 洛杉矶, 香港 | 荃湾区, 英国 | 伦敦)
	if (validFlag) {
		const flagPx = isSm ? 16 : 24;
		return (
			<span aria-hidden="true" className={cn(boxCls, "overflow-hidden p-0")}>
				<span
					className={cn(
						"fi fis block shadow-xs ring-1 ring-black/10 dark:ring-white/15",
						isSm ? "rounded-sm" : "rounded-full",
						`fi-${validFlag}`,
					)}
					style={{
						width: flagPx,
						height: flagPx,
						backgroundSize: "cover",
					}}
				/>
			</span>
		);
	}

	// Case 4: Generic Network Monitor Fallback
	return (
		<span
			aria-hidden="true"
			className={boxCls}
			style={{
				color: seriesColor,
			}}
		>
			{isSm ? (
				<Activity className="h-3.5 w-3.5" />
			) : (
				<Globe className="h-4.5 w-4.5" />
			)}
		</span>
	);
}
