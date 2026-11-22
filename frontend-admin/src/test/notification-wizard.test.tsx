import {
    INITIAL_WIZARD_INPUTS,
    MESSAGE_PLACEHOLDERS,
    buildNotificationFromPreset,
    detectNotifierPlatform,
    formatHumanBytes,
    summarizeAlertRules,
} from "@/lib/notification-presets"
import { describe, expect, it } from "vitest"

describe("notification-presets wizard helpers", () => {
    it("builds Telegram sendMessage payload and normalizes bot prefix", () => {
        const res = buildNotificationFromPreset("telegram", {
            ...INITIAL_WIZARD_INPUTS,
            tgToken: "bot123456:ABC-DEF",
            tgChatId: "-100987654",
            tgEndpoint: "https://api.telegram.org/",
        })
        expect(res).not.toBeNull()
        expect(res?.url).toBe("https://api.telegram.org/bot123456:ABC-DEF/sendMessage")
        expect(res?.request_method).toBe(2)
        expect(res?.request_type).toBe(1)
        const parsed = JSON.parse(res!.request_body)
        expect(parsed.chat_id).toBe("-100987654")
        expect(parsed.text).toContain("#NEZHA#")
        expect(parsed.text).toContain("#DATETIME#")
    })

    it("builds Bark payload from either bare device key or full URL", () => {
        const fromKey = buildNotificationFromPreset("bark", {
            ...INITIAL_WIZARD_INPUTS,
            barkKeyOrUrl: "myDeviceKey123/",
        })
        expect(fromKey?.url).toBe("https://api.day.app/myDeviceKey123")

        const fromUrl = buildNotificationFromPreset("bark", {
            ...INITIAL_WIZARD_INPUTS,
            barkKeyOrUrl: "https://bark.example.com/customKey/",
        })
        expect(fromUrl?.url).toBe("https://bark.example.com/customKey")
    })

    it("builds WeCom and Ntfy payloads accurately", () => {
        const wecom = buildNotificationFromPreset("wecom", {
            ...INITIAL_WIZARD_INPUTS,
            webhookUrl: "abc-key-999",
        })
        expect(wecom?.url).toBe("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-key-999")

        const ntfy = buildNotificationFromPreset("ntfy", {
            ...INITIAL_WIZARD_INPUTS,
            ntfyUrl: "https://ntfy.sh/nezha-topic-01",
        })
        expect(ntfy?.url).toBe("https://ntfy.sh")
        expect(JSON.parse(ntfy!.request_body).topic).toBe("nezha-topic-01")
    })

    it("detects platform badges from saved notification URLs", () => {
        expect(
            detectNotifierPlatform("https://api.telegram.org/bot111/sendMessage").id,
        ).toBe("telegram")
        expect(detectNotifierPlatform("https://api.day.app/xyz").id).toBe("bark")
        expect(
            detectNotifierPlatform("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1").id,
        ).toBe("wecom")
        expect(
            detectNotifierPlatform("https://open.feishu.cn/open-apis/bot/v2/hook/1").id,
        ).toBe("feishu")
        expect(detectNotifierPlatform("https://oapi.dingtalk.com/robot/send?access_token=1").id).toBe(
            "dingtalk",
        )
        expect(detectNotifierPlatform("https://sctapi.ftqq.com/SCT123.send").id).toBe("serverchan")
        expect(detectNotifierPlatform("https://www.pushplus.plus/send").id).toBe("pushplus")
        expect(detectNotifierPlatform("https://discord.com/api/webhooks/1/2").id).toBe("discord")
        expect(detectNotifierPlatform("https://ntfy.sh", '{"topic":"abc"}').id).toBe("ntfy")
        expect(detectNotifierPlatform("https://example.com/hook").id).toBe("custom")
    })

    it("formats bytes and summarizes alert rules in plain Chinese", () => {
        expect(formatHumanBytes(1024 ** 4)).toBe("1.00 TB")
        const summary = summarizeAlertRules([
            { type: "offline", duration: 60, cover: 0 },
            { type: "cpu", max: 90, duration: 180, cover: 0 },
            { type: "transfer_all_cycle", max: 1024 ** 4, cover: 0 },
        ])
        expect(summary).toEqual([
            "机器离线 ≥ 60秒",
            "CPU 占用率 (%) > 90% 持续180秒",
            "周期双向总流量超额 > 1.00 TB",
        ])
    })

    it("ensures every message placeholder is wrapped with # delimiters", () => {
        for (const item of MESSAGE_PLACEHOLDERS) {
            expect(item.token.startsWith("#")).toBe(true)
            expect(item.token.endsWith("#")).toBe(true)
        }
    })
})
