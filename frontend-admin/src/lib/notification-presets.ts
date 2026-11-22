export type NotifierPresetId =
    | "telegram"
    | "bark"
    | "wecom"
    | "feishu"
    | "dingtalk"
    | "serverchan"
    | "pushplus"
    | "discord"
    | "ntfy"
    | "custom"

export interface NotifierPresetMeta {
    id: NotifierPresetId
    label: string
    badge: string
    shortDesc: string
    recommended?: boolean
}

export const NOTIFIER_PRESETS: NotifierPresetMeta[] = [
    {
        id: "telegram",
        label: "Telegram 机器人",
        badge: "TG",
        shortDesc: "最常用，填 Bot Token 和 Chat ID 即可秒收消息",
        recommended: true,
    },
    {
        id: "bark",
        label: "Bark (苹果推送)",
        badge: "Bark",
        shortDesc: "iPhone / iPad 免费秒级系统通知，仅需填 Key",
    },
    {
        id: "wecom",
        label: "企业微信机器人",
        badge: "企微",
        shortDesc: "粘贴企业微信群机器人 Webhook 地址即可",
    },
    {
        id: "feishu",
        label: "飞书群机器人",
        badge: "飞书",
        shortDesc: "粘贴飞书自定义群机器人 Webhook 地址即可",
    },
    {
        id: "dingtalk",
        label: "钉钉群机器人",
        badge: "钉钉",
        shortDesc: "粘贴钉钉群机器人 Webhook（关键词填『探针』）",
    },
    {
        id: "serverchan",
        label: "Server酱 (微信)",
        badge: "微信",
        shortDesc: "填入 sct.ftqq.com 的 SendKey 推送到微信",
    },
    {
        id: "pushplus",
        label: "PushPlus (微信)",
        badge: "微信",
        shortDesc: "填入 pushplus.plus 的 Token 推送到微信",
    },
    {
        id: "discord",
        label: "Discord 频道",
        badge: "DC",
        shortDesc: "粘贴 Discord 频道整合里的 Webhook URL",
    },
    {
        id: "ntfy",
        label: "Ntfy 消息订阅",
        badge: "Ntfy",
        shortDesc: "开源轻量推送，填 ntfy.sh/你的主题名 即可",
    },
    {
        id: "custom",
        label: "自定义 Webhook",
        badge: "高级",
        shortDesc: "手动配置任意 HTTP GET/POST 接口与请求体",
    },
]

export interface WizardInputs {
    tgToken: string
    tgChatId: string
    tgEndpoint: string
    barkKeyOrUrl: string
    webhookUrl: string
    sendKey: string
    pushplusToken: string
    ntfyUrl: string
}

export const INITIAL_WIZARD_INPUTS: WizardInputs = {
    tgToken: "",
    tgChatId: "",
    tgEndpoint: "https://api.telegram.org",
    barkKeyOrUrl: "",
    webhookUrl: "",
    sendKey: "",
    pushplusToken: "",
    ntfyUrl: "",
}

export interface BuiltNotificationPayload {
    defaultName: string
    url: string
    request_method: number // 1=GET, 2=POST
    request_type: number // 1=JSON, 2=Form
    request_header: string
    request_body: string
    verify_tls: boolean
}

export function buildNotificationFromPreset(
    preset: NotifierPresetId,
    inputs: WizardInputs,
): BuiltNotificationPayload | null {
    switch (preset) {
        case "telegram": {
            const token = inputs.tgToken.trim().replace(/^bot/i, "")
            const chatId = inputs.tgChatId.trim()
            const base = (inputs.tgEndpoint.trim() || "https://api.telegram.org").replace(
                /\/+$/,
                "",
            )
            const url = token ? `${base}/bot${token}/sendMessage` : ""
            return {
                defaultName: "Telegram 机器人",
                url,
                request_method: 2,
                request_type: 1,
                request_header: "",
                request_body: JSON.stringify(
                    {
                        chat_id: chatId,
                        text: "🔔 #NEZHA#\n🕒 时间：#DATETIME#",
                    },
                    null,
                    2,
                ),
                verify_tls: true,
            }
        }
        case "bark": {
            const raw = inputs.barkKeyOrUrl.trim().replace(/\/+$/, "")
            let url = ""
            if (raw) {
                url = /^https?:\/\//i.test(raw) ? raw : `https://api.day.app/${raw}`
            }
            return {
                defaultName: "Bark 手机推送",
                url,
                request_method: 2,
                request_type: 1,
                request_header: "",
                request_body: JSON.stringify(
                    {
                        title: "探针监控通知",
                        body: "#NEZHA#\n时间：#DATETIME#",
                        group: "Nezha",
                    },
                    null,
                    2,
                ),
                verify_tls: true,
            }
        }
        case "wecom": {
            const raw = inputs.webhookUrl.trim()
            const url =
                raw && !/^https?:\/\//i.test(raw)
                    ? `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${raw}`
                    : raw
            return {
                defaultName: "企业微信机器人",
                url,
                request_method: 2,
                request_type: 1,
                request_header: "",
                request_body: JSON.stringify(
                    {
                        msgtype: "text",
                        text: {
                            content: "🔔 探针监控通知\n#NEZHA#\n🕒 时间：#DATETIME#",
                        },
                    },
                    null,
                    2,
                ),
                verify_tls: true,
            }
        }
        case "feishu": {
            return {
                defaultName: "飞书群机器人",
                url: inputs.webhookUrl.trim(),
                request_method: 2,
                request_type: 1,
                request_header: "",
                request_body: JSON.stringify(
                    {
                        msg_type: "text",
                        content: {
                            text: "🔔 探针监控通知\n#NEZHA#\n🕒 时间：#DATETIME#",
                        },
                    },
                    null,
                    2,
                ),
                verify_tls: true,
            }
        }
        case "dingtalk": {
            return {
                defaultName: "钉钉群机器人",
                url: inputs.webhookUrl.trim(),
                request_method: 2,
                request_type: 1,
                request_header: "",
                request_body: JSON.stringify(
                    {
                        msgtype: "text",
                        text: {
                            content: "【探针监控通知】\n#NEZHA#\n🕒 时间：#DATETIME#",
                        },
                    },
                    null,
                    2,
                ),
                verify_tls: true,
            }
        }
        case "serverchan": {
            const key = inputs.sendKey.trim()
            const url = key
                ? /^https?:\/\//i.test(key)
                    ? key
                    : `https://sctapi.ftqq.com/${key}.send`
                : ""
            return {
                defaultName: "Server酱微信推送",
                url,
                request_method: 2,
                request_type: 1,
                request_header: "",
                request_body: JSON.stringify(
                    {
                        title: "探针监控提醒",
                        desp: "#NEZHA#\n\n时间：#DATETIME#",
                    },
                    null,
                    2,
                ),
                verify_tls: true,
            }
        }
        case "pushplus": {
            return {
                defaultName: "PushPlus 微信推送",
                url: "https://www.pushplus.plus/send",
                request_method: 2,
                request_type: 1,
                request_header: "",
                request_body: JSON.stringify(
                    {
                        token: inputs.pushplusToken.trim(),
                        title: "探针监控提醒",
                        content: "#NEZHA#\n时间：#DATETIME#",
                        template: "txt",
                    },
                    null,
                    2,
                ),
                verify_tls: true,
            }
        }
        case "discord": {
            return {
                defaultName: "Discord 频道通知",
                url: inputs.webhookUrl.trim(),
                request_method: 2,
                request_type: 1,
                request_header: "",
                request_body: JSON.stringify(
                    {
                        content: "🔔 **#NEZHA#**\n🕒 `#DATETIME#`",
                    },
                    null,
                    2,
                ),
                verify_tls: true,
            }
        }
        case "ntfy": {
            const raw = inputs.ntfyUrl.trim().replace(/\/+$/, "")
            let serverOrigin = "https://ntfy.sh"
            let topic = raw
            if (/^https?:\/\//i.test(raw)) {
                try {
                    const u = new URL(raw)
                    serverOrigin = u.origin
                    topic = u.pathname.replace(/^\/+/, "") || "nezha"
                } catch {
                    serverOrigin = "https://ntfy.sh"
                }
            }
            return {
                defaultName: "Ntfy 推送",
                url: raw ? serverOrigin : "",
                request_method: 2,
                request_type: 1,
                request_header: "",
                request_body: JSON.stringify(
                    {
                        topic,
                        title: "探针监控通知",
                        message: "#NEZHA#\n时间：#DATETIME#",
                    },
                    null,
                    2,
                ),
                verify_tls: true,
            }
        }
        default:
            return null
    }
}

export function detectNotifierPlatform(url?: string, body?: string): {
    id: NotifierPresetId
    label: string
} {
    const u = (url || "").toLowerCase()
    const b = (body || "").toLowerCase()
    if (u.includes("telegram.org") || /\/bot[^/]+\/sendmessage/.test(u)) {
        return { id: "telegram", label: "Telegram" }
    }
    if (u.includes("api.day.app") || b.includes('"group":"nezha"')) {
        return { id: "bark", label: "Bark" }
    }
    if (u.includes("qyapi.weixin.qq.com")) {
        return { id: "wecom", label: "企业微信" }
    }
    if (u.includes("feishu.cn") || u.includes("larksuite.com")) {
        return { id: "feishu", label: "飞书" }
    }
    if (u.includes("oapi.dingtalk.com")) {
        return { id: "dingtalk", label: "钉钉" }
    }
    if (u.includes("sctapi.ftqq.com")) {
        return { id: "serverchan", label: "Server酱" }
    }
    if (u.includes("pushplus.plus")) {
        return { id: "pushplus", label: "PushPlus" }
    }
    if (u.includes("discord.com/api/webhooks") || u.includes("discordapp.com/api/webhooks")) {
        return { id: "discord", label: "Discord" }
    }
    if (u.includes("ntfy.sh") || b.includes('"topic"')) {
        return { id: "ntfy", label: "Ntfy" }
    }
    return { id: "custom", label: "Webhook" }
}

export const MESSAGE_PLACEHOLDERS: Array<{ token: string; label: string }> = [
    { token: "#NEZHA#", label: "通知正文" },
    { token: "#DATETIME#", label: "触发时间" },
    { token: "#SERVER.NAME#", label: "机器名称" },
    { token: "#SERVER.IP#", label: "机器 IP" },
    { token: "#SERVER.CPU#", label: "CPU 占用" },
    { token: "#SERVER.MEM#", label: "内存占用" },
    { token: "#SERVER.DISK#", label: "硬盘占用" },
    { token: "#SERVER.SPEEDIN#", label: "实时下行" },
    { token: "#SERVER.SPEEDOUT#", label: "实时上行" },
]

export interface AlertMetricMeta {
    value: string
    label: string
    unit: "%" | "B/s" | "B" | "℃" | "" | "秒"
    hint: string
}

export const ALERT_METRIC_OPTIONS: AlertMetricMeta[] = [
    {
        value: "offline",
        label: "🔴 机器离线 / 失联",
        unit: "秒",
        hint: "小鸡断开连接超过指定秒数时发通知（最推荐开启！）",
    },
    {
        value: "cpu",
        label: "🔥 CPU 占用率 (%)",
        unit: "%",
        hint: "填 0~100 的百分比数字，例如上限填 90 代表 CPU 超过 90% 报警",
    },
    {
        value: "memory",
        label: "💾 内存占用率 (%)",
        unit: "%",
        hint: "填 0~100 的百分比数字，例如上限填 90 代表内存超过 90% 报警",
    },
    {
        value: "disk",
        label: "💿 硬盘空间占用率 (%)",
        unit: "%",
        hint: "填 0~100 的百分比数字，例如上限填 85 代表硬盘用了 85% 以上报警",
    },
    {
        value: "swap",
        label: "🔄 虚拟内存 Swap 占用率 (%)",
        unit: "%",
        hint: "填 0~100 的百分比数字",
    },
    {
        value: "temperature_max",
        label: "🌡️ 硬件最高温度 (℃)",
        unit: "℃",
        hint: "例如上限填 80 代表温度超过 80℃ 报警",
    },
    {
        value: "load1",
        label: "📈 系统 1 分钟负载 (Load1)",
        unit: "",
        hint: "Linux 平均负载数值，例如 4 核机器可设上限 4 或 6",
    },
    {
        value: "load5",
        label: "📈 系统 5 分钟负载 (Load5)",
        unit: "",
        hint: "5 分钟平均负载数值",
    },
    {
        value: "load15",
        label: "📈 系统 15 分钟负载 (Load15)",
        unit: "",
        hint: "15 分钟平均负载数值",
    },
    {
        value: "net_out_speed",
        label: "⬆️ 实时上传网速",
        unit: "B/s",
        hint: "单位为字节/秒，可直接点下方快捷按钮自动换算填入",
    },
    {
        value: "net_in_speed",
        label: "⬇️ 实时下载网速",
        unit: "B/s",
        hint: "单位为字节/秒，可直接点下方快捷按钮自动换算填入",
    },
    {
        value: "net_all_speed",
        label: "↕️ 实时双向总网速",
        unit: "B/s",
        hint: "上传 + 下载合计网速（字节/秒）",
    },
    {
        value: "tcp_conn_count",
        label: "🔗 TCP 连接数",
        unit: "",
        hint: "例如上限填 10000 防止连接数异常飙升",
    },
    {
        value: "udp_conn_count",
        label: "🔗 UDP 连接数",
        unit: "",
        hint: "例如上限填 10000 防止异常发包",
    },
    {
        value: "process_count",
        label: "⚙️ 运行进程总数",
        unit: "",
        hint: "例如上限填 1000",
    },
    {
        value: "gpu",
        label: "🎮 显卡 GPU 占用率 (%)",
        unit: "%",
        hint: "填 0~100 百分比",
    },
    {
        value: "transfer_all_cycle",
        label: "📊 周期双向总流量超额",
        unit: "B",
        hint: "仅用于超额发告警通知；若只想前台显示流量条，在服务器『公开备注』填配额即可自动显示",
    },
    {
        value: "transfer_out_cycle",
        label: "📤 周期上传流量超额",
        unit: "B",
        hint: "单向出站周期流量超额告警",
    },
    {
        value: "transfer_in_cycle",
        label: "📥 周期下载流量超额",
        unit: "B",
        hint: "单向入站周期流量超额告警",
    },
    {
        value: "transfer_all",
        label: "∑ 开机累计总流量",
        unit: "B",
        hint: "网卡自开机以来的累计总流量（字节）",
    },
    {
        value: "transfer_out",
        label: "∑ 开机累计上传流量",
        unit: "B",
        hint: "网卡自开机以来的累计上传流量（字节）",
    },
    {
        value: "transfer_in",
        label: "∑ 开机累计下载流量",
        unit: "B",
        hint: "网卡自开机以来的累计下载流量（字节）",
    },
]

export function formatHumanBytes(bytes?: number): string {
    if (bytes === undefined || bytes === null || Number.isNaN(bytes) || bytes <= 0) return ""
    const units = ["B", "KB", "MB", "GB", "TB", "PB"]
    let v = bytes
    let idx = 0
    while (v >= 1024 && idx < units.length - 1) {
        v /= 1024
        idx++
    }
    return `${v.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`
}

export function summarizeAlertRules(rules?: Array<Record<string, any>>): string[] {
    if (!Array.isArray(rules) || rules.length === 0) return ["未配置条件"]
    return rules.map((r) => {
        const meta = ALERT_METRIC_OPTIONS.find((m) => m.value === r.type)
        const name = meta ? meta.label.replace(/^[^\s]+\s/, "") : r.type || "未知指标"
        if (r.type === "offline") {
            return `机器离线 ≥ ${r.duration ?? 10}秒`
        }
        const parts: string[] = [name]
        if (typeof r.max === "number" && r.max > 0) {
            if (meta?.unit === "B") {
                parts.push(`> ${formatHumanBytes(r.max)}`)
            } else if (meta?.unit === "B/s") {
                parts.push(`> ${formatHumanBytes(r.max)}/s`)
            } else {
                parts.push(`> ${r.max}${meta?.unit || ""}`)
            }
        }
        if (typeof r.min === "number" && r.min > 0) {
            parts.push(`< ${r.min}${meta?.unit || ""}`)
        }
        if (r.duration && !String(r.type).endsWith("_cycle")) {
            parts.push(`持续${r.duration}秒`)
        }
        return parts.join(" ")
    })
}
