import { runAllInspections, testExpiryNotification, updateSettings } from "@/api/settings"
import { SettingsTab } from "@/components/settings-tab"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/useAuth"
import { useNotification } from "@/hooks/useNotfication"
import useSetting from "@/hooks/useSetting"
import {
    DEFAULT_CN_HOLIDAYS,
    DEFAULT_MEDIA_PLATFORMS,
    DEFAULT_THEME_CONFIG,
    type ThemeConfig,
    mergeThemeConfig,
} from "@/types"
import {
    Activity,
    BarChart3,
    BellRing,
    Calculator,
    CalendarClock,
    Filter,
    Globe2,
    LayoutGrid,
    MessageSquareHeart,
    Palette,
    Play,
    Plus,
    RotateCcw,
    Save,
    Send,
    Sparkles,
    Sun,
    Tag,
    Trash2,
    Tv,
    Wallet,
} from "lucide-react"
import { type FormEvent, useEffect, useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Navigate } from "react-router-dom"
import { toast } from "sonner"

interface SwitchRowProps {
    id: string
    label: string
    description?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
}

function SwitchRow({ id, label, description, checked, onCheckedChange }: SwitchRowProps) {
    return (
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
                <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
                    {label}
                </Label>
                {description && (
                    <p className="text-xs text-muted-foreground">{description}</p>
                )}
            </div>
            <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    )
}

const MEDIA_PLATFORM_OPTIONS: Array<{ id: string; label: string; group: string }> = [
    { id: "netflix", label: "Netflix", group: "流媒体" },
    { id: "disney", label: "Disney+", group: "流媒体" },
    { id: "youtube", label: "YouTube Premium", group: "流媒体" },
    { id: "tiktok", label: "TikTok", group: "流媒体" },
    { id: "spotify", label: "Spotify", group: "流媒体" },
    { id: "prime", label: "Prime Video", group: "流媒体" },
    { id: "hbo", label: "Max (HBO)", group: "流媒体" },
    { id: "bilibili", label: "Bilibili", group: "流媒体" },
    { id: "chatgpt", label: "ChatGPT / OpenAI", group: "AI" },
    { id: "claude", label: "Claude", group: "AI" },
    { id: "gemini", label: "Google Gemini", group: "AI" },
]

export default function ThemeCustomPage() {
    const { t } = useTranslation()
    const { data: settingResp, mutate } = useSetting()
    const { profile, loading: authLoading } = useAuth()
    const { notifierGroup } = useNotification()
    const idPrefix = useId()
    const fieldId = (name: string) => `${idPrefix}-${name}`

    const isAdmin = profile?.role === 0

    const [themeConfig, setThemeConfig] = useState<ThemeConfig>(() =>
        mergeThemeConfig(settingResp?.config?.theme_config),
    )
    const [saving, setSaving] = useState(false)
    const [runningInspect, setRunningInspect] = useState(false)
    const [testingExpiry, setTestingExpiry] = useState(false)

    useEffect(() => {
        if (settingResp?.config) {
            setThemeConfig(mergeThemeConfig(settingResp.config.theme_config))
        }
    }, [settingResp?.config])

    const enabledModuleCount = useMemo(() => {
        const flags = [
            themeConfig.traffic_bar.enabled,
            themeConfig.remaining_value.enabled,
            themeConfig.finance_widget.enabled,
            themeConfig.trade_calc.enabled,
            themeConfig.welcome_bubble.enabled,
            themeConfig.earth_globe.enabled,
            themeConfig.ping_board.enabled,
            themeConfig.traffic_stats.enabled,
            themeConfig.greeting.enabled,
            themeConfig.renewal_calendar.enabled,
            themeConfig.media_unlock.enabled,
            themeConfig.expiry_notify.enabled,
            themeConfig.showcase_card.enabled,
            themeConfig.filter_bar.enabled,
        ]
        return flags.filter(Boolean).length
    }, [themeConfig])

    if (authLoading) {
        return null
    }
    if (!isAdmin) {
        return <Navigate to="/dashboard/settings/api-tokens" replace />
    }

    const updateSection = <K extends keyof ThemeConfig>(
        section: K,
        patch: Partial<ThemeConfig[K]>,
    ) => {
        setThemeConfig((prev) => ({
            ...prev,
            [section]: {
                ...prev[section],
                ...patch,
            },
        }))
    }

    const handleSetAllModules = (enabled: boolean) => {
        setThemeConfig((prev) => ({
            ...prev,
            traffic_bar: { ...prev.traffic_bar, enabled },
            remaining_value: { ...prev.remaining_value, enabled },
            finance_widget: { ...prev.finance_widget, enabled },
            trade_calc: { ...prev.trade_calc, enabled },
            welcome_bubble: { ...prev.welcome_bubble, enabled },
            earth_globe: { ...prev.earth_globe, enabled },
            ping_board: { ...prev.ping_board, enabled },
            traffic_stats: { ...prev.traffic_stats, enabled },
            greeting: { ...prev.greeting, enabled },
            renewal_calendar: { ...prev.renewal_calendar, enabled },
            dock: { ...prev.dock, enabled },
            media_unlock: { ...prev.media_unlock, enabled },
            showcase_card: { ...prev.showcase_card, enabled },
            filter_bar: { ...prev.filter_bar, enabled },
        }))
    }

    const handleToggleMediaPlatform = (platformId: string) => {
        const current = themeConfig.media_unlock.platforms
        const exists = current.includes(platformId)
        const next = exists ? current.filter((p) => p !== platformId) : [...current, platformId]
        updateSection("media_unlock", {
            platforms: next.length > 0 ? next : [...DEFAULT_MEDIA_PLATFORMS],
        })
    }

    const handleRunAllInspections = async () => {
        setRunningInspect(true)
        try {
            const res = await runAllInspections()
            toast.success(`已向 ${res.queued} 台在线节点下发错峰体检任务（流媒体 / 回程 / IP）`)
        } catch (err) {
            toast.error("触发全量体检失败", { description: String(err) })
        } finally {
            setRunningInspect(false)
        }
    }

    const handleTestExpiryNotify = async () => {
        setTestingExpiry(true)
        try {
            const res = await testExpiryNotification()
            toast.success(
                res.matched > 0
                    ? `已推送 ${res.matched} 台临期服务器提醒至通知组`
                    : "已发送测试通知，当前无临期服务器",
            )
        } catch (err) {
            toast.error("发送测试提醒失败", { description: String(err) })
        } finally {
            setTestingExpiry(false)
        }
    }

    const handleResetDefaults = () => {
        setThemeConfig(structuredClone(DEFAULT_THEME_CONFIG))
        toast.info(t("ThemeStudio.ResetHint", { defaultValue: "已恢复默认配置，点击保存后生效" }))
    }

    const handleAddLink = () => {
        updateSection("appearance", {
            custom_links: [...themeConfig.appearance.custom_links, { name: "", link: "" }],
        })
    }

    const handleUpdateLink = (index: number, field: "name" | "link", value: string) => {
        const next = themeConfig.appearance.custom_links.map((item, i) =>
            i === index ? { ...item, [field]: value } : item,
        )
        updateSection("appearance", { custom_links: next })
    }

    const handleRemoveLink = (index: number) => {
        updateSection("appearance", {
            custom_links: themeConfig.appearance.custom_links.filter((_, i) => i !== index),
        })
    }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        const current = settingResp?.config
        if (!current) {
            toast.error(t("Error"))
            return
        }

        const sanitizedConfig: ThemeConfig = {
            ...themeConfig,
            appearance: {
                ...themeConfig.appearance,
                custom_links: themeConfig.appearance.custom_links
                    .map((item) => ({
                        name: item.name.trim(),
                        link: item.link.trim(),
                    }))
                    .filter((item) => item.name && item.link),
            },
        }

        setSaving(true)
        try {
            const fallbackTemplate =
                settingResp?.frontend_templates?.find((tpl) => !tpl.is_admin)?.path || "user-dist"
            await updateSettings({
                site_name: current.site_name || "Nezha",
                language: current.language || "zh-CN",
                user_template: current.user_template || fallbackTemplate,
                cover: current.cover ?? 0,
                ip_change_notification_group_id: current.ip_change_notification_group_id ?? 0,
                custom_code: current.custom_code,
                custom_code_dashboard: current.custom_code_dashboard,
                install_host: current.install_host,
                dashboard_host: current.dashboard_host,
                reserved_hosts: current.reserved_hosts,
                nat_member_domains: current.nat_member_domains,
                dns_servers: current.dns_servers,
                web_real_ip_header: current.web_real_ip_header,
                agent_real_ip_header: current.agent_real_ip_header,
                ignored_ip_notification: current.ignored_ip_notification,
                tls: current.tls,
                enable_ip_change_notification: current.enable_ip_change_notification,
                enable_plain_ip_in_notification: current.enable_plain_ip_in_notification,
                enable_mcp: current.enable_mcp,
                online_stats_days: current.online_stats_days,
                theme_config: sanitizedConfig,
            })
            await mutate()
            toast.success(t("Success"))
        } catch (err) {
            toast.error(t("Error"), {
                description: t("Results.ErrorFetchingResource", {
                    error: err?.toString(),
                }),
            })
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="px-3 pb-10">
            <SettingsTab className="mt-6 mb-4 w-full" />

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Top summary banner */}
                <Card>
                    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-primary" />
                                <CardTitle>
                                    {t("ThemeStudio.Title", {
                                        defaultValue: "主题增强可视化配置",
                                    })}
                                </CardTitle>
                                <Badge variant="secondary">
                                    {t("ThemeStudio.EnabledCount", {
                                        count: enabledModuleCount,
                                        total: 14,
                                        defaultValue: `已启用 ${enabledModuleCount} / 14 项`,
                                    })}
                                </Badge>
                            </div>
                            <CardDescription>
                                {t("ThemeStudio.Description", {
                                    defaultValue:
                                        "所有自定义增强功能已原生内置并持久化至后端配置，无需手写 HTML/JS 自定义代码即可按需开关与调参。",
                                })}
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleSetAllModules(true)}
                            >
                                {t("ThemeStudio.EnableAll", { defaultValue: "全部开启" })}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleSetAllModules(false)}
                            >
                                {t("ThemeStudio.DisableAll", { defaultValue: "全部关闭" })}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleResetDefaults}
                            >
                                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                {t("ThemeStudio.ResetDefaults", { defaultValue: "恢复默认" })}
                            </Button>
                            <Button type="submit" size="sm" disabled={saving}>
                                <Save className="mr-1.5 h-3.5 w-3.5" />
                                {saving
                                    ? t("ThemeStudio.Saving", { defaultValue: "保存中..." })
                                    : t("Confirm")}
                            </Button>
                        </div>
                    </CardHeader>
                </Card>

                {/* 1. 外观与全局布局 */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Palette className="h-4 w-4 text-primary" />
                            {t("ThemeStudio.Sections.Appearance", {
                                defaultValue: "外观、字体与全局布局",
                            })}
                        </CardTitle>
                        <CardDescription>
                            {t("ThemeStudio.Sections.AppearanceDesc", {
                                defaultValue:
                                    "对应副标题、背景图与模糊效果、自定义字体、导航栏链接以及卡片基础展示行为。",
                            })}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <legend className="sr-only">基础外观参数</legend>
                            <div className="space-y-1.5">
                                <Label htmlFor={fieldId("custom_desc")}>
                                    {t("ThemeStudio.Fields.CustomDesc", {
                                        defaultValue: "左上角站点副标题",
                                    })}
                                </Label>
                                <Input
                                    id={fieldId("custom_desc")}
                                    placeholder="例如：TG @JohnMuyno"
                                    value={themeConfig.appearance.custom_desc}
                                    onChange={(e) =>
                                        updateSection("appearance", { custom_desc: e.target.value })
                                    }
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor={fieldId("custom_logo")}>
                                    {t("ThemeStudio.Fields.CustomLogo", {
                                        defaultValue: "自定义 Logo 地址",
                                    })}
                                </Label>
                                <Input
                                    id={fieldId("custom_logo")}
                                    placeholder="留空使用默认图标，支持 https:// 或 /路径"
                                    value={themeConfig.appearance.custom_logo}
                                    onChange={(e) =>
                                        updateSection("appearance", { custom_logo: e.target.value })
                                    }
                                    spellCheck={false}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor={fieldId("background_image")}>
                                    {t("ThemeStudio.Fields.BackgroundImage", {
                                        defaultValue: "桌面端背景图 URL",
                                    })}
                                </Label>
                                <Input
                                    id={fieldId("background_image")}
                                    placeholder="https://example.com/bg.webp"
                                    value={themeConfig.appearance.background_image}
                                    onChange={(e) =>
                                        updateSection("appearance", {
                                            background_image: e.target.value,
                                        })
                                    }
                                    spellCheck={false}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor={fieldId("mobile_background_image")}>
                                    {t("ThemeStudio.Fields.MobileBackgroundImage", {
                                        defaultValue: "移动端背景图 URL（可选）",
                                    })}
                                </Label>
                                <Input
                                    id={fieldId("mobile_background_image")}
                                    placeholder="留空则共用桌面端背景图"
                                    value={themeConfig.appearance.mobile_background_image}
                                    onChange={(e) =>
                                        updateSection("appearance", {
                                            mobile_background_image: e.target.value,
                                        })
                                    }
                                    spellCheck={false}
                                />
                            </div>
                        </fieldset>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                            <SwitchRow
                                id={fieldId("show_net_transfer")}
                                label="卡片显示上下行总流量"
                                description="在服务器卡片中显示累计上传/下载流量标签"
                                checked={themeConfig.appearance.show_net_transfer}
                                onCheckedChange={(checked) =>
                                    updateSection("appearance", { show_net_transfer: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("fixed_top_server_name")}
                                label="服务器名称固定在卡片顶部"
                                description="更适合卡片内展示多行流量条和延迟面板"
                                checked={themeConfig.appearance.fixed_top_server_name}
                                onCheckedChange={(checked) =>
                                    updateSection("appearance", { fixed_top_server_name: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("disable_animated_man")}
                                label="隐藏默认动画小人插画"
                                description="隐藏网络总览卡片右上角的小人动图"
                                checked={themeConfig.appearance.disable_animated_man}
                                onCheckedChange={(checked) =>
                                    updateSection("appearance", { disable_animated_man: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("background_blur")}
                                label="背景图毛玻璃与压暗遮罩"
                                description="开启背景图时提升卡片与文字可读性"
                                checked={themeConfig.appearance.background_blur}
                                onCheckedChange={(checked) =>
                                    updateSection("appearance", { background_blur: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("hide_footer")}
                                label="隐藏页面底部页脚"
                                description="隐藏页脚版权和主题信息栏"
                                checked={themeConfig.appearance.hide_footer}
                                onCheckedChange={(checked) =>
                                    updateSection("appearance", { hide_footer: checked })
                                }
                            />
                        </div>

                        <Separator />

                        {/* 字体设置 */}
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div className="space-y-1.5">
                                <Label htmlFor={fieldId("font_preset")}>全局字体预设</Label>
                                <Select
                                    value={themeConfig.appearance.font_preset}
                                    onValueChange={(value) =>
                                        updateSection("appearance", {
                                            font_preset: value as ThemeConfig["appearance"]["font_preset"],
                                        })
                                    }
                                >
                                    <SelectTrigger id={fieldId("font_preset")}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="default">系统默认字体 (Inter)</SelectItem>
                                        <SelectItem value="misans">MiSans（小米兰亭风格）</SelectItem>
                                        <SelectItem value="lxgw">LXGW WenKai（霞鹜文楷）</SelectItem>
                                        <SelectItem value="custom">自定义字体 CSS</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {themeConfig.appearance.font_preset === "custom" && (
                                <>
                                    <div className="space-y-1.5">
                                        <Label htmlFor={fieldId("custom_font_url")}>
                                            字体 CSS 地址
                                        </Label>
                                        <Input
                                            id={fieldId("custom_font_url")}
                                            placeholder="https://.../font.css"
                                            value={themeConfig.appearance.custom_font_url}
                                            onChange={(e) =>
                                                updateSection("appearance", {
                                                    custom_font_url: e.target.value,
                                                })
                                            }
                                            spellCheck={false}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor={fieldId("custom_font_family")}>
                                            font-family 名称
                                        </Label>
                                        <Input
                                            id={fieldId("custom_font_family")}
                                            placeholder="例如：'LXGW WenKai Screen', sans-serif"
                                            value={themeConfig.appearance.custom_font_family}
                                            onChange={(e) =>
                                                updateSection("appearance", {
                                                    custom_font_family: e.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        <Separator />

                        {/* 自定义导航栏链接 */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <Label className="text-sm font-medium">自定义导航栏链接</Label>
                                    <p className="text-xs text-muted-foreground">
                                        显示在顶部导航栏中，支持任意数量（如官网、博客、文档）
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleAddLink}
                                >
                                    <Plus className="mr-1 h-3.5 w-3.5" />
                                    添加链接
                                </Button>
                            </div>
                            {themeConfig.appearance.custom_links.length === 0 ? (
                                <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                                    暂无自定义链接，点击右上角「添加链接」即可新增
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {themeConfig.appearance.custom_links.map((item, idx) => (
                                        <div
                                            key={idx}
                                            className="grid grid-cols-1 gap-2 rounded-md border p-2.5 sm:grid-cols-[1fr_2fr_auto]"
                                        >
                                            <Input
                                                aria-label={`链接名称 ${idx + 1}`}
                                                placeholder="显示名称（如：官网）"
                                                value={item.name}
                                                onChange={(e) =>
                                                    handleUpdateLink(idx, "name", e.target.value)
                                                }
                                            />
                                            <Input
                                                aria-label={`链接地址 ${idx + 1}`}
                                                placeholder="https://example.com/"
                                                value={item.link}
                                                onChange={(e) =>
                                                    handleUpdateLink(idx, "link", e.target.value)
                                                }
                                                spellCheck={false}
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label={`删除链接 ${idx + 1}`}
                                                onClick={() => handleRemoveLink(idx)}
                                            >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* 2. 智能问候语与建站运行时间 */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Sun className="h-4 w-4 text-amber-500" />
                            智能问候语 &amp; 建站运行时间
                        </CardTitle>
                        <CardDescription>
                            替换首页顶部「概览」区域，按工作日/周末/节假日和时段展示问候语及实时运行时长。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <SwitchRow
                                id={fieldId("greeting_enabled")}
                                label="启用自定义头部概览"
                                checked={themeConfig.greeting.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("greeting", { enabled: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("greeting_show")}
                                label="显示时段/节日问候语"
                                checked={themeConfig.greeting.show_greeting}
                                onCheckedChange={(checked) =>
                                    updateSection("greeting", { show_greeting: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("uptime_show")}
                                label="显示建站已运行时长"
                                checked={themeConfig.greeting.show_uptime}
                                onCheckedChange={(checked) =>
                                    updateSection("greeting", { show_uptime: checked })
                                }
                            />
                        </div>
                        {themeConfig.greeting.enabled && (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor={fieldId("start_date")}>建站起始时间</Label>
                                    <Input
                                        id={fieldId("start_date")}
                                        type="datetime-local"
                                        step="1"
                                        value={themeConfig.greeting.start_date.slice(0, 19)}
                                        onChange={(e) =>
                                            updateSection("greeting", {
                                                start_date: e.target.value,
                                            })
                                        }
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor={fieldId("custom_holidays")}>
                                            法定节假日日期（月-日，英文逗号分隔）
                                        </Label>
                                        <Button
                                            type="button"
                                            variant="link"
                                            size="sm"
                                            className="h-auto p-0 text-xs"
                                            onClick={() =>
                                                updateSection("greeting", {
                                                    custom_holidays: DEFAULT_CN_HOLIDAYS,
                                                })
                                            }
                                        >
                                            填入默认节假日
                                        </Button>
                                    </div>
                                    <Textarea
                                        id={fieldId("custom_holidays")}
                                        rows={2}
                                        placeholder="1-1,1-2,1-3,10-1..."
                                        value={themeConfig.greeting.custom_holidays}
                                        onChange={(e) =>
                                            updateSection("greeting", {
                                                custom_holidays: e.target.value,
                                            })
                                        }
                                    />
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* 3. 服务器卡片增强三件套 */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    {/* 周期流量进度条 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <BarChart3 className="h-4 w-4 text-emerald-500" />
                                卡片周期流量进度条
                            </CardTitle>
                            <CardDescription>
                                在服务器卡片内嵌渐变流量进度条与重置日轮播信息
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("tb_enabled")}
                                label="启用卡片流量条"
                                checked={themeConfig.traffic_bar.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("traffic_bar", { enabled: checked })
                                }
                            />
                            {themeConfig.traffic_bar.enabled && (
                                <>
                                    <SwitchRow
                                        id={fieldId("tb_insert_after")}
                                        label="放在总流量标签下方"
                                        checked={themeConfig.traffic_bar.insert_after}
                                        onCheckedChange={(checked) =>
                                            updateSection("traffic_bar", { insert_after: checked })
                                        }
                                    />
                                    <SwitchRow
                                        id={fieldId("tb_hide_legacy")}
                                        label="隐藏原版独立周期流量卡片"
                                        description="避免服务页重复展示同一份周期流量"
                                        checked={themeConfig.traffic_bar.hide_legacy_cycle_box}
                                        onCheckedChange={(checked) =>
                                            updateSection("traffic_bar", {
                                                hide_legacy_cycle_box: checked,
                                            })
                                        }
                                    />
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label htmlFor={fieldId("tb_interval")}>
                                                刷新间隔 (ms)
                                            </Label>
                                            <Input
                                                id={fieldId("tb_interval")}
                                                type="number"
                                                min={5000}
                                                max={3600000}
                                                value={themeConfig.traffic_bar.interval_ms}
                                                onChange={(e) =>
                                                    updateSection("traffic_bar", {
                                                        interval_ms: Number(e.target.value) || 60000,
                                                    })
                                                }
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor={fieldId("tb_toggle")}>
                                                轮播间隔 (ms, 0关)
                                            </Label>
                                            <Input
                                                id={fieldId("tb_toggle")}
                                                type="number"
                                                min={0}
                                                max={600000}
                                                value={themeConfig.traffic_bar.toggle_interval_ms}
                                                onChange={(e) =>
                                                    updateSection("traffic_bar", {
                                                        toggle_interval_ms:
                                                            Number(e.target.value) || 0,
                                                    })
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor={fieldId("tb_duration")}>
                                            切换淡入淡出时长 (ms)
                                        </Label>
                                        <Input
                                            id={fieldId("tb_duration")}
                                            type="number"
                                            min={0}
                                            max={5000}
                                            value={themeConfig.traffic_bar.duration_ms}
                                            onChange={(e) =>
                                                updateSection("traffic_bar", {
                                                    duration_ms: Number(e.target.value) || 0,
                                                })
                                            }
                                        />
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* VPS 剩余价值标签 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Tag className="h-4 w-4 text-green-500" />
                                VPS 剩余价值标签
                            </CardTitle>
                            <CardDescription>
                                根据服务器计费备注自动计算剩余价值并按比例分级着色
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("rv_enabled")}
                                label="启用剩余价值标签"
                                checked={themeConfig.remaining_value.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("remaining_value", { enabled: checked })
                                }
                            />
                            {themeConfig.remaining_value.enabled && (
                                <>
                                    <div className="space-y-1">
                                        <Label htmlFor={fieldId("rv_text")}>标签前缀文字</Label>
                                        <Input
                                            id={fieldId("rv_text")}
                                            placeholder="剩余"
                                            value={themeConfig.remaining_value.tag_text}
                                            onChange={(e) =>
                                                updateSection("remaining_value", {
                                                    tag_text: e.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor={fieldId("rv_pos")}>标签插入位置</Label>
                                        <Select
                                            value={themeConfig.remaining_value.tag_position}
                                            onValueChange={(value) =>
                                                updateSection("remaining_value", {
                                                    tag_position: value as "first" | "last",
                                                })
                                            }
                                        >
                                            <SelectTrigger id={fieldId("rv_pos")}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="last">套餐标签末尾</SelectItem>
                                                <SelectItem value="first">套餐标签最前</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor={fieldId("rv_cur")}>默认货币符号</Label>
                                        <Input
                                            id={fieldId("rv_cur")}
                                            placeholder="$"
                                            value={themeConfig.remaining_value.default_currency}
                                            onChange={(e) =>
                                                updateSection("remaining_value", {
                                                    default_currency: e.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* 三网实时延迟 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Activity className="h-4 w-4 text-sky-500" />
                                三网实时延迟面板
                            </CardTitle>
                            <CardDescription>
                                懒加载可视卡片的电信/联通/移动 IPv4 与 IPv6 实时延迟
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("ping_enabled")}
                                label="启用三网延迟开关"
                                checked={themeConfig.ping_board.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("ping_board", { enabled: checked })
                                }
                            />
                            {themeConfig.ping_board.enabled && (
                                <>
                                    <SwitchRow
                                        id={fieldId("ping_default_on")}
                                        label="访客首次访问默认开启"
                                        description="关闭时需访客手动点开关，可节省 API 请求"
                                        checked={themeConfig.ping_board.default_on}
                                        onCheckedChange={(checked) =>
                                            updateSection("ping_board", { default_on: checked })
                                        }
                                    />
                                    <div className="space-y-1">
                                        <Label htmlFor={fieldId("ping_interval")}>
                                            可视卡片刷新间隔 (秒)
                                        </Label>
                                        <Input
                                            id={fieldId("ping_interval")}
                                            type="number"
                                            min={5}
                                            max={600}
                                            value={themeConfig.ping_board.refresh_interval_sec}
                                            onChange={(e) =>
                                                updateSection("ping_board", {
                                                    refresh_interval_sec:
                                                        Number(e.target.value) || 20,
                                                })
                                            }
                                        />
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* 4. 访客欢迎气泡 & 悬浮胶囊 Dock */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <MessageSquareHeart className="h-4 w-4 text-pink-500" />
                                访客欢迎气泡
                            </CardTitle>
                            <CardDescription>
                                左下角弹出访客归属地、系统/浏览器、可打码 IP 与运营商信息
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("welcome_enabled")}
                                label="启用访客欢迎气泡"
                                checked={themeConfig.welcome_bubble.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("welcome_bubble", { enabled: checked })
                                }
                            />
                            {themeConfig.welcome_bubble.enabled && (
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label htmlFor={fieldId("welcome_title")}>气泡标题</Label>
                                        <Input
                                            id={fieldId("welcome_title")}
                                            placeholder="Hello!"
                                            value={themeConfig.welcome_bubble.title}
                                            onChange={(e) =>
                                                updateSection("welcome_bubble", {
                                                    title: e.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor={fieldId("welcome_close")}>
                                            自动关闭时间 (ms, 0不自动关)
                                        </Label>
                                        <Input
                                            id={fieldId("welcome_close")}
                                            type="number"
                                            min={0}
                                            max={300000}
                                            value={themeConfig.welcome_bubble.auto_close_ms}
                                            onChange={(e) =>
                                                updateSection("welcome_bubble", {
                                                    auto_close_ms: Number(e.target.value) || 0,
                                                })
                                            }
                                        />
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <LayoutGrid className="h-4 w-4 text-indigo-500" />
                                Mac 风格悬浮胶囊 Dock
                            </CardTitle>
                            <CardDescription>
                                统一收纳下方 5 个工具球，PC 端侧边垂直居中，移动端底部横向居中
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("dock_enabled")}
                                label="显示悬浮工具栏 Dock"
                                description="关闭后将隐藏右侧/底部悬浮工具球入口"
                                checked={themeConfig.dock.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("dock", { enabled: checked })
                                }
                            />
                            {themeConfig.dock.enabled && (
                                <div className="space-y-1">
                                    <Label htmlFor={fieldId("dock_pos")}>桌面端停靠位置</Label>
                                    <Select
                                        value={themeConfig.dock.position}
                                        onValueChange={(value) =>
                                            updateSection("dock", {
                                                position: value as "right" | "left",
                                            })
                                        }
                                    >
                                        <SelectTrigger id={fieldId("dock_pos")}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="right">右侧垂直居中</SelectItem>
                                            <SelectItem value="left">左侧垂直居中</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* 5. Dock 五大工具模块 */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* 资产统计 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Wallet className="h-4 w-4 text-emerald-500" />
                                资产统计悬浮面板
                            </CardTitle>
                            <CardDescription>
                                自动统计总资产、月均成本、月付支出、剩余价值，支持实时汇率换算
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("fin_enabled")}
                                label="启用资产统计工具"
                                checked={themeConfig.finance_widget.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("finance_widget", { enabled: checked })
                                }
                            />
                            {themeConfig.finance_widget.enabled && (
                                <div className="space-y-1">
                                    <Label htmlFor={fieldId("fin_currency")}>默认显示币种</Label>
                                    <Select
                                        value={themeConfig.finance_widget.default_currency}
                                        onValueChange={(value) =>
                                            updateSection("finance_widget", {
                                                default_currency:
                                                    value as ThemeConfig["finance_widget"]["default_currency"],
                                            })
                                        }
                                    >
                                        <SelectTrigger id={fieldId("fin_currency")}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="CNY">CNY (￥)</SelectItem>
                                            <SelectItem value="USD">USD ($)</SelectItem>
                                            <SelectItem value="HKD">HKD (HK$)</SelectItem>
                                            <SelectItem value="EUR">EUR (€)</SelectItem>
                                            <SelectItem value="GBP">GBP (£)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* 交易与发帖助手 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Calculator className="h-4 w-4 text-violet-500" />
                                VPS 交易与发帖助手
                            </CardTitle>
                            <CardDescription>
                                闲置出机/预算收机计算器、伴生机打包结算台与 Markdown 发帖生成器
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("tc_enabled")}
                                label="启用交易发帖助手"
                                checked={themeConfig.trade_calc.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("trade_calc", { enabled: checked })
                                }
                            />
                            {themeConfig.trade_calc.enabled && (
                                <>
                                    <div className="space-y-1">
                                        <Label htmlFor={fieldId("tc_contact")}>默认联系方式</Label>
                                        <Input
                                            id={fieldId("tc_contact")}
                                            placeholder="站内私信 / PM"
                                            value={themeConfig.trade_calc.default_contact}
                                            onChange={(e) =>
                                                updateSection("trade_calc", {
                                                    default_contact: e.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor={fieldId("tc_note")}>默认交易声明</Label>
                                        <Input
                                            id={fieldId("tc_note")}
                                            placeholder="支付宝口令红包或中介交易，中介费自理"
                                            value={themeConfig.trade_calc.default_note}
                                            onChange={(e) =>
                                                updateSection("trade_calc", {
                                                    default_note: e.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* 3D 节点地球 & 全维度流量透视 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Globe2 className="h-4 w-4 text-blue-500" />
                                3D 节点拓扑地球 &amp; 全维度流量透视
                            </CardTitle>
                            <CardDescription>
                                3D 全球节点飞线地球，以及限量池/无限池流量环形图与耗尽预测
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("earth_enabled")}
                                label="启用 3D 节点拓扑地球"
                                checked={themeConfig.earth_globe.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("earth_globe", { enabled: checked })
                                }
                            />
                            {themeConfig.earth_globe.enabled && (
                                <div className="space-y-1">
                                    <Label htmlFor={fieldId("earth_speed")}>
                                        自动旋转速度 (0 ~ 10)
                                    </Label>
                                    <Input
                                        id={fieldId("earth_speed")}
                                        type="number"
                                        step="0.1"
                                        min={0}
                                        max={10}
                                        value={themeConfig.earth_globe.auto_rotate_speed}
                                        onChange={(e) =>
                                            updateSection("earth_globe", {
                                                auto_rotate_speed: Number(e.target.value) || 0,
                                            })
                                        }
                                    />
                                </div>
                            )}
                            <Separator />
                            <SwitchRow
                                id={fieldId("ts_enabled")}
                                label="启用全维度流量透视面板"
                                description="首页显示全局大盘分布，详情页自动切换为单机消耗诊断"
                                checked={themeConfig.traffic_stats.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("traffic_stats", { enabled: checked })
                                }
                            />
                        </CardContent>
                    </Card>

                    {/* 资产续费推演日历 & 到期预警 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <CalendarClock className="h-4 w-4 text-rose-500" />
                                资产续费推演日历 &amp; 到期预警
                            </CardTitle>
                            <CardDescription>
                                年/月/周三视图循环推演续费日程，并在右下角弹出临期服务器提醒
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("cal_enabled")}
                                label="启用续费推演日历"
                                checked={themeConfig.renewal_calendar.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("renewal_calendar", { enabled: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("cal_alerts")}
                                label="开启右下角临期预警弹窗"
                                description="自动提醒即将到期的服务器"
                                checked={themeConfig.renewal_calendar.enable_expiry_alerts}
                                onCheckedChange={(checked) =>
                                    updateSection("renewal_calendar", {
                                        enable_expiry_alerts: checked,
                                    })
                                }
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label htmlFor={fieldId("cal_urgent_days")}>
                                        预警阈值 (天内到期)
                                    </Label>
                                    <Input
                                        id={fieldId("cal_urgent_days")}
                                        type="number"
                                        min={0}
                                        max={365}
                                        value={themeConfig.renewal_calendar.urgent_days}
                                        onChange={(e) =>
                                            updateSection("renewal_calendar", {
                                                urgent_days: Number(e.target.value) || 0,
                                            })
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor={fieldId("cal_max_alerts")}>
                                        最多弹出预警数
                                    </Label>
                                    <Input
                                        id={fieldId("cal_max_alerts")}
                                        type="number"
                                        min={1}
                                        max={20}
                                        value={themeConfig.renewal_calendar.max_alert_count}
                                        onChange={(e) =>
                                            updateSection("renewal_calendar", {
                                                max_alert_count: Number(e.target.value) || 3,
                                            })
                                        }
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* 12. 流媒体解锁、三网回程与 IP 体检 */}
                <Card>
                    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Tv className="h-4 w-4 text-primary" />
                                流媒体 & AI 解锁、三网回程与 IP 体检（详情页独立分区）
                            </CardTitle>
                            <CardDescription>
                                复用原生 Agent 命令通道错峰执行轻量检测，结果存入后端 SQLite；不点开详情页分区时不消耗前端资源。
                            </CardDescription>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={runningInspect}
                            onClick={handleRunAllInspections}
                        >
                            <Play className="mr-1.5 h-3.5 w-3.5" />
                            {runningInspect ? "下发中..." : "立即全量体检所有在线节点"}
                        </Button>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                            <SwitchRow
                                id={fieldId("media_enabled")}
                                label="开启详情页「流媒体 & 体检」独立分区"
                                description="在前台服务器详情页新增第 4 个选项卡并启用体检接口"
                                checked={themeConfig.media_unlock.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("media_unlock", { enabled: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("media_ipv6")}
                                label="同时检测 IPv6 双栈解锁能力"
                                description="自动探测节点是否具备 IPv6 出口并分别展示"
                                checked={themeConfig.media_unlock.check_ipv6}
                                onCheckedChange={(checked) =>
                                    updateSection("media_unlock", { check_ipv6: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("media_backhaul")}
                                label="包含三网回程路由简报"
                                description="自动识别电信 CN2 GIA/GT/163、联通 9929/4837、移动 CMIN2/CMI"
                                checked={themeConfig.media_unlock.check_backhaul}
                                onCheckedChange={(checked) =>
                                    updateSection("media_unlock", { check_backhaul: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("media_ipq")}
                                label="包含 IP 质量、Google 送中、25 端口与黑名单体检"
                                description="展示 ASN/机房或家宽参考、风控评级、SMTP 25 端口通断"
                                checked={themeConfig.media_unlock.check_ip_quality}
                                onCheckedChange={(checked) =>
                                    updateSection("media_unlock", { check_ip_quality: checked })
                                }
                            />
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor={fieldId("media_interval")}>自动定时检测周期</Label>
                                <Select
                                    value={String(themeConfig.media_unlock.auto_interval_hours)}
                                    onValueChange={(v) =>
                                        updateSection("media_unlock", {
                                            auto_interval_hours: Number(v),
                                        })
                                    }
                                >
                                    <SelectTrigger id={fieldId("media_interval")}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="0">仅手动触发（不自动轮询）</SelectItem>
                                        <SelectItem value="6">每 6 小时自动体检</SelectItem>
                                        <SelectItem value="12">每 12 小时自动体检</SelectItem>
                                        <SelectItem value="24">每 24 小时自动体检（推荐）</SelectItem>
                                        <SelectItem value="72">每 3 天自动体检</SelectItem>
                                        <SelectItem value="168">每 7 天自动体检</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor={fieldId("media_conc")}>
                                    最大并发体检节点数（保护低配面板，推荐 2）
                                </Label>
                                <Input
                                    id={fieldId("media_conc")}
                                    type="number"
                                    min={1}
                                    max={5}
                                    value={themeConfig.media_unlock.max_concurrency}
                                    onChange={(e) =>
                                        updateSection("media_unlock", {
                                            max_concurrency: Math.min(
                                                5,
                                                Math.max(1, Number(e.target.value) || 2),
                                            ),
                                        })
                                    }
                                />
                            </div>
                        </div>

                        <fieldset className="space-y-2 rounded-lg border p-3">
                            <legend className="px-1 text-xs font-medium text-muted-foreground">
                                勾选需要检测的流媒体与 AI 平台
                            </legend>
                            <div className="flex flex-wrap gap-2">
                                {MEDIA_PLATFORM_OPTIONS.map((item) => {
                                    const active = themeConfig.media_unlock.platforms.includes(
                                        item.id,
                                    )
                                    return (
                                        <Button
                                            key={item.id}
                                            type="button"
                                            size="sm"
                                            variant={active ? "default" : "outline"}
                                            onClick={() => handleToggleMediaPlatform(item.id)}
                                            className="h-7 text-xs"
                                        >
                                            {item.label}
                                        </Button>
                                    )
                                })}
                            </div>
                        </fieldset>
                    </CardContent>
                </Card>

                {/* 13. 机器到期自动推送通知 & 14. 测评卡片与多维筛选 */}
                <div className="grid gap-6 lg:grid-cols-2">
                    <Card>
                        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <BellRing className="h-4 w-4 text-primary" />
                                    机器到期自动推送通知
                                </CardTitle>
                                <CardDescription>
                                    每日定时扫描服务器账单日期，临期直接复用哪吒通知组（TG / 邮件 / Webhook）推送。
                                </CardDescription>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={testingExpiry}
                                onClick={handleTestExpiryNotify}
                            >
                                <Send className="mr-1.5 h-3.5 w-3.5" />
                                {testingExpiry ? "推送中..." : "立即扫描/测试"}
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("exp_notify_enabled")}
                                label="开启后端到期自动通知"
                                description="无需打开网页，到期前自动发消息提醒续费"
                                checked={themeConfig.expiry_notify.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("expiry_notify", { enabled: checked })
                                }
                            />
                            <div className="space-y-1.5">
                                <Label htmlFor={fieldId("exp_notify_group")}>推送通知组</Label>
                                <Select
                                    value={String(themeConfig.expiry_notify.notification_group_id || 0)}
                                    onValueChange={(v) =>
                                        updateSection("expiry_notify", {
                                            notification_group_id: Number(v) || 0,
                                        })
                                    }
                                >
                                    <SelectTrigger id={fieldId("exp_notify_group")}>
                                        <SelectValue placeholder="请选择通知组" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="0">-- 未选择通知组 --</SelectItem>
                                        {(notifierGroup ?? []).map((ng) => (
                                            <SelectItem key={ng.group.id} value={String(ng.group.id)}>
                                                {ng.group.name} (ID: {ng.group.id})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label htmlFor={fieldId("exp_alert_days")}>
                                        提前提醒天数（逗号分隔）
                                    </Label>
                                    <Input
                                        id={fieldId("exp_alert_days")}
                                        placeholder="7,3,1"
                                        value={themeConfig.expiry_notify.alert_days}
                                        onChange={(e) =>
                                            updateSection("expiry_notify", {
                                                alert_days: e.target.value,
                                            })
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor={fieldId("exp_check_hour")}>
                                        每日检测时间（时）
                                    </Label>
                                    <Input
                                        id={fieldId("exp_check_hour")}
                                        type="number"
                                        min={0}
                                        max={23}
                                        value={themeConfig.expiry_notify.check_hour}
                                        onChange={(e) =>
                                            updateSection("expiry_notify", {
                                                check_hour: Math.min(
                                                    23,
                                                    Math.max(0, Number(e.target.value) || 0),
                                                ),
                                            })
                                        }
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Filter className="h-4 w-4 text-primary" />
                                节点测评卡片 & 前台多维筛选
                            </CardTitle>
                            <CardDescription>
                                详情页一键生成论坛 Markdown/高清图片测评卡，首页支持按解锁、到期、价格多维检索排序。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <SwitchRow
                                id={fieldId("showcase_enabled")}
                                label="开启详情页「生成测评/分享卡片」"
                                description="一键汇总硬件、三网延迟、流媒体解锁、回程路由与剩余价值并支持导出 PNG 海报"
                                checked={themeConfig.showcase_card.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("showcase_card", { enabled: checked })
                                }
                            />
                            <SwitchRow
                                id={fieldId("filter_bar_enabled")}
                                label="开启首页多维筛选与快捷搜索栏"
                                description="支持按名称/商家/线路检索，以及按 Netflix/Disney+/ChatGPT/Claude/Gemini 解锁、30天内到期、剩余价值排序"
                                checked={themeConfig.filter_bar.enabled}
                                onCheckedChange={(checked) =>
                                    updateSection("filter_bar", { enabled: checked })
                                }
                            />
                        </CardContent>
                    </Card>
                </div>

                {/* Bottom save bar */}
                <div className="flex justify-end gap-3 pt-2">
                    <Button type="button" variant="outline" onClick={handleResetDefaults}>
                        <RotateCcw className="mr-1.5 h-4 w-4" />
                        {t("ThemeStudio.ResetDefaults", { defaultValue: "恢复默认" })}
                    </Button>
                    <Button type="submit" disabled={saving}>
                        <Save className="mr-1.5 h-4 w-4" />
                        {saving
                            ? t("ThemeStudio.Saving", { defaultValue: "保存中..." })
                            : t("ThemeStudio.SaveChanges", { defaultValue: "保存主题增强配置" })}
                    </Button>
                </div>
            </form>
        </div>
    )
}
