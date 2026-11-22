import { describe, expect, it } from "vitest";
import {
	detectMonitorMeta,
	getLatencyHealth,
} from "@/features/network-monitor/monitor-icons";

describe("detectMonitorMeta", () => {
	it("recognizes Chinese three-network carriers and IPv4/IPv6 stacks", () => {
		const ct4 = detectMonitorMeta("电信 | V4");
		expect(ct4.brand?.id).toBe("chinatelecom");
		expect(ct4.brand?.iconSrc).toBeTruthy();
		expect(ct4.ipStack).toBe("IPv4");
		expect(ct4.isDomesticCarrier).toBe(true);

		const cu6 = detectMonitorMeta("联通 | V6");
		expect(cu6.brand?.id).toBe("chinaunicom");
		expect(cu6.ipStack).toBe("IPv6");
		expect(cu6.isDomesticCarrier).toBe(true);

		const cm4 = detectMonitorMeta("移动 | V4");
		expect(cm4.brand?.id).toBe("chinamobile");
		expect(cm4.ipStack).toBe("IPv4");

		const gia = detectMonitorMeta("上海 CN2 GIA IPv4");
		expect(gia.brand?.id).toBe("chinatelecom");
		expect(gia.routeTag).toBe("CN2 GIA");
		expect(gia.ipStack).toBe("IPv4");
	});

	it("recognizes overseas region and city monitors automatically", () => {
		const us = detectMonitorMeta("美国 | 洛杉矶");
		expect(us.brand).toBeNull();
		expect(us.countryCode).toBe("US");
		expect(us.isDomesticCarrier).toBe(false);

		const hk = detectMonitorMeta("香港 | 荃湾区");
		expect(hk.countryCode).toBe("HK");

		const uk = detectMonitorMeta("英国 | 伦敦");
		expect(uk.countryCode).toBe("GB");

		const jp = detectMonitorMeta("Tokyo BGP");
		expect(jp.countryCode).toBe("JP");
		expect(jp.routeTag).toBe("BGP");
	});

	it("recognizes overseas telecom carriers and global clouds with implied or explicit country", () => {
		const ntt = detectMonitorMeta("日本 | NTT");
		expect(ntt.brand?.id).toBe("ntt");
		expect(ntt.countryCode).toBe("JP");

		const cf = detectMonitorMeta("美国 | Cloudflare");
		expect(cf.brand?.id).toBe("cloudflare");
		expect(cf.countryCode).toBe("US");

		const hetzner = detectMonitorMeta("Hetzner Falkenstein");
		expect(hetzner.brand?.id).toBe("hetzner");
		expect(hetzner.countryCode).toBe("DE");

		const hkt = detectMonitorMeta("香港 HKT 商宽");
		expect(hkt.brand?.id).toBe("pccw");
		expect(hkt.brand?.monogram).toBe("HKT");
		expect(hkt.countryCode).toBe("HK");
	});

	it("falls back cleanly for generic custom monitor names", () => {
		const generic = detectMonitorMeta("Alpha");
		expect(generic.brand).toBeNull();
		expect(generic.countryCode).toBeNull();
		expect(generic.ipStack).toBeNull();
		expect(generic.isDomesticCarrier).toBe(false);
	});

	it("classifies latency health tiers with non-color signal bar counts", () => {
		expect(getLatencyHealth(35)).toMatchObject({ tier: "excellent", bars: 4 });
		expect(getLatencyHealth(120)).toMatchObject({ tier: "good", bars: 3 });
		expect(getLatencyHealth(210)).toMatchObject({ tier: "fair", bars: 2 });
		expect(getLatencyHealth(350)).toMatchObject({ tier: "poor", bars: 1 });
		expect(getLatencyHealth(null)).toMatchObject({ tier: "none", bars: 0 });
	});
});
