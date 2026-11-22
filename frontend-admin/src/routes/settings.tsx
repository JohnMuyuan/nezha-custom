import { updateSettings } from "@/api/settings"
import { SettingsTab } from "@/components/settings-tab"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox } from "@/components/ui/combobox"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/useAuth"
import { useNotification } from "@/hooks/useNotfication"
import useSetting from "@/hooks/useSetting"
import { asOptionalField, safeExternalHref } from "@/lib/utils"
import { nezhaLang, settingCoverageTypes } from "@/types"
import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronDown, Globe, Server, ShieldCheck, Sparkles, Wrench } from "lucide-react"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Link, Navigate } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

const settingFormSchema = z.object({
    dns_servers: asOptionalField(z.string()),
    ignored_ip_notification: asOptionalField(z.string()),
    ip_change_notification_group_id: z.coerce.number().int().min(0),
    cover: z.coerce.number().int().min(1),
    online_stats_days: z.coerce.number().int().min(7).max(3650),
    site_name: z.string().min(1),
    language: z.string().min(2),
    user_template: z.string().min(1),
    install_host: asOptionalField(z.string()),
    dashboard_host: asOptionalField(z.string()),
    reserved_hosts: asOptionalField(z.string()),
    nat_member_domains: z.string(),
    custom_code: asOptionalField(z.string()),
    custom_code_dashboard: asOptionalField(z.string()),
    web_real_ip_header: asOptionalField(z.string()),
    agent_real_ip_header: asOptionalField(z.string()),

    tls: asOptionalField(z.boolean()),
    enable_ip_change_notification: asOptionalField(z.boolean()),
    enable_plain_ip_in_notification: asOptionalField(z.boolean()),
    enable_mcp: asOptionalField(z.boolean()),
})

export default function SettingsPage() {
    const { t, i18n } = useTranslation()
    const { data: config, mutate } = useSetting()
    const { profile, loading: authLoading } = useAuth()

    const { notifierGroup } = useNotification()
    const ngroupList = notifierGroup?.map((ng) => ({
        value: `${ng.group.id}`,
        label: ng.group.name,
    })) || [{ value: "", label: "" }]

    const isAdmin = profile?.role === 0

    // 所有 hooks 必须在条件 return 之前调用，否则违反 rules-of-hooks。
    const form = useForm({
        resolver: zodResolver(settingFormSchema) as any,
        defaultValues: config
            ? {
                  ...config.config,
                  // 兼容尚未包含 online_stats_days 的旧后端：字段缺省时回退默认值
                  online_stats_days: config.config?.online_stats_days ?? 7,
                  nat_member_domains: (config.config?.nat_member_domains ?? []).join("\n"),
                  user_template:
                      config.config?.user_template ||
                      Object.keys(config.frontend_templates?.filter((t) => !t.is_admin) || {})[0] ||
                      "user-dist",
              }
            : {
                  ip_change_notification_group_id: 0,
                  cover: 1,
                  online_stats_days: 7,
                  nat_member_domains: "",
                  site_name: "",
                  language: "",
                  user_template: "user-dist",
              },
        resetOptions: {
            keepDefaultValues: false,
        },
    })

    useEffect(() => {
        if (config?.config) {
            form.reset({
                ...config.config,
                online_stats_days: config.config?.online_stats_days ?? 7,
                nat_member_domains: (config.config?.nat_member_domains ?? []).join("\n"),
            })
        }
    }, [config?.config, form])

    if (authLoading) {
        return null
    }
    if (!isAdmin) {
        return <Navigate to="/dashboard/settings/api-tokens" replace />
    }

    const onSubmit = async (values: any) => {
        try {
            await updateSettings({
                ...values,
                // Send [] when cleared: omitting the field preserves the server's previous policy.
                nat_member_domains: values.nat_member_domains
                    .split("\n")
                    .map((domain: string) => domain.trim())
                    .filter(Boolean),
            })
            form.reset()
            await mutate()
        } catch (e) {
            toast(t("Error"), {
                description: t("Results.ErrorFetchingResource", {
                    error: e?.toString(),
                }),
            })
            return
        }
        if (values.language != i18n.language) {
            i18n.changeLanguage(values.language)
        }
        toast(t("Success"))
    }

    return (
        <div className="mx-auto max-w-5xl px-3 pb-10">
            <SettingsTab className="mt-6 mb-4 w-full" />

            {/* 新手快捷引导横幅 */}
            <Card className="mb-5 border-primary/25 bg-primary/5">
                <CardContent className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1 text-sm">
                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                            <Sparkles className="h-4 w-4 text-primary" />
                            <span>
                                {t("ThemeStudio.BannerTitle", {
                                    defaultValue: "✨ 小白友好向导：外观功能 & 周期流量已全自动内置",
                                })}
                            </span>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            1. 想改背景图、Logo、流媒体检测、到期提醒、3D 地球？直接点右侧按钮可视化开关。
                            <br />
                            2. <strong>周期流量进度条已全自动开启</strong>：只需在「服务器管理 → 编辑 → 公开备注」填好流量配额和账单日期即可自动统计，无需再去「警报规则」逐台配置！
                        </p>
                    </div>
                    <Button asChild size="sm" variant="default" className="shrink-0">
                        <Link to="/dashboard/settings/theme-custom">
                            {t("ThemeStudio.BannerAction", { defaultValue: "打开主题增强设置" })}
                        </Link>
                    </Button>
                </CardContent>
            </Card>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    {/* 卡片 1：基础外观与在线统计 */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Globe className="h-4 w-4 text-blue-500" />
                                一、站点基础信息（常看）
                            </CardTitle>
                            <CardDescription>
                                设置探针网页左上角标题、默认界面语言、前台主题以及机器在线历史的保留天数。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="site_name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("SiteName")}</FormLabel>
                                        <FormControl>
                                            <Input placeholder="例如：我的云监控探针" {...field} />
                                        </FormControl>
                                        <FormDescription className="text-xs">
                                            显示在浏览器标签页与前台左上角的名字。
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="language"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("Language")}</FormLabel>
                                        <FormControl>
                                            <Select
                                                onValueChange={field.onChange}
                                                value={field.value}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {Object.entries(nezhaLang).map(([k, v]) => (
                                                        <SelectItem key={k} value={k}>
                                                            {v}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </FormControl>
                                        <FormDescription className="text-xs">
                                            新访客首次打开探针时默认看到的界面语言。
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="user_template"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("Theme")}</FormLabel>
                                        <FormControl>
                                            <Select
                                                value={field.value}
                                                onValueChange={(value) => {
                                                    const template =
                                                        config?.frontend_templates?.find(
                                                            (tpl) => tpl.path === value,
                                                        )
                                                    if (template) {
                                                        form.setValue(
                                                            "user_template",
                                                            template.path!,
                                                        )
                                                    }
                                                }}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="py-6">
                                                        <SelectValue
                                                            placeholder={t("SelectTheme")}
                                                        />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {(
                                                        config?.frontend_templates?.filter(
                                                            (tpl) => !tpl.is_admin,
                                                        ) || []
                                                    ).map((template) => (
                                                        <div key={template.path}>
                                                            <SelectItem value={template.path!}>
                                                                <div className="flex flex-col items-start gap-1">
                                                                    <div className="font-medium">
                                                                        {template.name}
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                                        <span>
                                                                            {t("Author")}:{" "}
                                                                            {template.author}
                                                                        </span>
                                                                        {!template.is_official ? (
                                                                            <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                                                                                {t("Community")}
                                                                            </span>
                                                                        ) : (
                                                                            <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                                                                                {t("Official")}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </SelectItem>
                                                            <div className="px-8 py-1">
                                                                {safeExternalHref(
                                                                    template.repository,
                                                                ) ? (
                                                                    <a
                                                                        href={safeExternalHref(
                                                                            template.repository,
                                                                        )}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                                                                    >
                                                                        {template.repository}
                                                                    </a>
                                                                ) : (
                                                                    <span className="text-sm text-muted-foreground">
                                                                        {template.repository}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </FormControl>
                                        <FormDescription className="text-xs">
                                            保持默认的官方内置主题即可享受全部魔改增强功能。
                                        </FormDescription>
                                        <FormMessage />
                                        {config?.frontend_templates?.length ? (
                                            !config?.frontend_templates?.find(
                                                (tpl) => tpl.path === field.value,
                                            )?.is_official && (
                                                <div className="mt-2 rounded-md border border-yellow-200 bg-yellow-100 p-2 text-sm text-yellow-700 dark:border-yellow-700 dark:bg-yellow-900 dark:text-yellow-200">
                                                    <div className="mb-1 font-medium">
                                                        {t("CommunityThemeWarning")}
                                                    </div>
                                                    <div>{t("CommunityThemeDescription")}</div>
                                                </div>
                                            )
                                        ) : null}
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="online_stats_days"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <FormLabel>{t("OnlineStatsDays")}</FormLabel>
                                            <div className="flex items-center gap-1">
                                                {[7, 30, 90, 365].map((days) => (
                                                    <Button
                                                        key={days}
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-6 px-2 text-[11px]"
                                                        onClick={() =>
                                                            form.setValue(
                                                                "online_stats_days",
                                                                days,
                                                                { shouldValidate: true },
                                                            )
                                                        }
                                                    >
                                                        {days}天
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={7}
                                                max={3650}
                                                placeholder="7"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormDescription className="text-xs">
                                            {t("OnlineStatsDaysHint")}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                    </Card>

                    {/* 卡片 2：小鸡安装对接设置 */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Server className="h-4 w-4 text-emerald-500" />
                                二、小鸡（被控端）安装连接设置
                            </CardTitle>
                            <CardDescription>
                                当你在「服务器管理」点击复制一键安装脚本时，小鸡就是通过下面这个地址连回你的面板上报数据的。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <FormField
                                control={form.control}
                                name="install_host"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("DashboardOriginalHost")}</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="例如：154.16.27.244:20070 或 agent.example.com:443"
                                                autoCorrect="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormDescription className="text-xs">
                                            不要带 <code>http://</code> 或 <code>https://</code>！直接填「面板服务器 IP:端口」或「未开启小黄云的域名:端口」。
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="tls"
                                render={({ field }) => (
                                    <FormItem className="rounded-lg border bg-muted/30 p-3">
                                        <FormControl>
                                            <div className="flex items-start gap-2.5">
                                                <Checkbox
                                                    id="cfg_tls_chk"
                                                    className="mt-0.5"
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                                <div className="space-y-1">
                                                    <Label
                                                        htmlFor="cfg_tls_chk"
                                                        className="cursor-pointer text-sm font-medium leading-snug"
                                                    >
                                                        {t("ConfigTLS")}
                                                    </Label>
                                                    <p className="text-xs text-muted-foreground">
                                                        小白判断法则：上面如果填的是 <code>IP:端口</code>（如 <code>1.2.3.4:20070</code>），<strong>千万别勾选</strong>；只有通过 Nginx/Caddy 给该端口配好了 HTTPS 证书才勾选。
                                                    </p>
                                                </div>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                    </Card>

                    {/* 卡片 3：真实 IP 识别 & 换 IP 通知 */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <ShieldCheck className="h-4 w-4 text-amber-500" />
                                三、真实 IP 识别 & 小鸡换 IP 提醒
                            </CardTitle>
                            <CardDescription>
                                如果面板前面套了 Cloudflare 或 Nginx 反向代理，点下方快捷按钮即可一键填好真实 IP 来源，否则访客气泡和防爆破可能全部识别成代理 IP。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="grid gap-5 md:grid-cols-2">
                                <FormField
                                    control={form.control}
                                    name="web_real_ip_header"
                                    render={({ field }) => (
                                        <FormItem className="space-y-2 rounded-lg border p-3">
                                            <FormLabel>{t("WebRealIPHeader")}</FormLabel>
                                            <div className="flex flex-wrap gap-1.5">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 px-2 text-[11px]"
                                                    onClick={() =>
                                                        form.setValue(
                                                            "web_real_ip_header",
                                                            "CF-Connecting-IP",
                                                        )
                                                    }
                                                >
                                                    套了 Cloudflare
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 px-2 text-[11px]"
                                                    onClick={() =>
                                                        form.setValue(
                                                            "web_real_ip_header",
                                                            "X-Real-IP",
                                                        )
                                                    }
                                                >
                                                    Nginx / 1Panel 反代
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 px-2 text-[11px]"
                                                    onClick={() =>
                                                        form.setValue(
                                                            "web_real_ip_header",
                                                            "NZ::Use-Peer-IP",
                                                        )
                                                    }
                                                >
                                                    未套反代（直连）
                                                </Button>
                                            </div>
                                            <FormControl>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Input
                                                        disabled={
                                                            field.value == "NZ::Use-Peer-IP"
                                                        }
                                                        className="flex-1 min-w-[160px]"
                                                        placeholder="CF-Connecting-IP"
                                                        autoCorrect="off"
                                                        autoCapitalize="none"
                                                        spellCheck={false}
                                                        {...field}
                                                    />
                                                    <div className="flex items-center gap-1.5">
                                                        <Checkbox
                                                            id="web_direct_ip_chk"
                                                            checked={
                                                                field.value == "NZ::Use-Peer-IP"
                                                            }
                                                            onCheckedChange={(checked) => {
                                                                form.setValue(
                                                                    "web_real_ip_header",
                                                                    checked
                                                                        ? "NZ::Use-Peer-IP"
                                                                        : "",
                                                                )
                                                            }}
                                                        />
                                                        <Label
                                                            htmlFor="web_direct_ip_chk"
                                                            className="cursor-pointer font-normal text-xs"
                                                        >
                                                            {t("UseDirectConnectingIP")}
                                                        </Label>
                                                    </div>
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="agent_real_ip_header"
                                    render={({ field }) => (
                                        <FormItem className="space-y-2 rounded-lg border p-3">
                                            <FormLabel>{t("AgentRealIPHeader")}</FormLabel>
                                            <div className="flex flex-wrap gap-1.5">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 px-2 text-[11px]"
                                                    onClick={() =>
                                                        form.setValue(
                                                            "agent_real_ip_header",
                                                            "NZ::Use-Peer-IP",
                                                        )
                                                    }
                                                >
                                                    小鸡 IP 直连（最常见）
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 px-2 text-[11px]"
                                                    onClick={() =>
                                                        form.setValue(
                                                            "agent_real_ip_header",
                                                            "CF-Connecting-IP",
                                                        )
                                                    }
                                                >
                                                    套了 Cloudflare gRPC
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 px-2 text-[11px]"
                                                    onClick={() =>
                                                        form.setValue(
                                                            "agent_real_ip_header",
                                                            "X-Real-IP",
                                                        )
                                                    }
                                                >
                                                    Nginx gRPC 反代
                                                </Button>
                                            </div>
                                            <FormControl>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Input
                                                        disabled={
                                                            field.value == "NZ::Use-Peer-IP"
                                                        }
                                                        className="flex-1 min-w-[160px]"
                                                        placeholder="CF-Connecting-IP"
                                                        autoCorrect="off"
                                                        autoCapitalize="none"
                                                        spellCheck={false}
                                                        {...field}
                                                    />
                                                    <div className="flex items-center gap-1.5">
                                                        <Checkbox
                                                            id="agent_direct_ip_chk"
                                                            checked={
                                                                field.value == "NZ::Use-Peer-IP"
                                                            }
                                                            onCheckedChange={(checked) => {
                                                                form.setValue(
                                                                    "agent_real_ip_header",
                                                                    checked
                                                                        ? "NZ::Use-Peer-IP"
                                                                        : "",
                                                                )
                                                            }}
                                                        />
                                                        <Label
                                                            htmlFor="agent_direct_ip_chk"
                                                            className="cursor-pointer font-normal text-xs"
                                                        >
                                                            {t("UseDirectConnectingIP")}
                                                        </Label>
                                                    </div>
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* IP 变动通知子区块 */}
                            <fieldset className="space-y-4 rounded-lg border bg-muted/20 p-4">
                                <legend className="px-1.5 text-sm font-semibold">
                                    {t("IPChangeNotification")}
                                </legend>
                                <p className="text-xs text-muted-foreground -mt-2">
                                    适合拥有动态 IP 家宽小鸡的用户：当小鸡自动重拨更换公网 IP 时，自动发消息通知你。不需要的话保持关闭即可。
                                </p>
                                <div className="grid gap-4 md:grid-cols-3">
                                    <FormField
                                        control={form.control}
                                        name="enable_ip_change_notification"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center rounded-md border bg-background px-3 py-2.5">
                                                <FormControl>
                                                    <div className="flex items-center gap-2">
                                                        <Checkbox
                                                            id="enable_ip_notify_chk"
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                        <Label
                                                            htmlFor="enable_ip_notify_chk"
                                                            className="cursor-pointer text-sm"
                                                        >
                                                            开启换 IP 提醒
                                                        </Label>
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="enable_plain_ip_in_notification"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center rounded-md border bg-background px-3 py-2.5 md:col-span-2">
                                                <FormControl>
                                                    <div className="flex items-center gap-2">
                                                        <Checkbox
                                                            id="plain_ip_notify_chk"
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                        <Label
                                                            htmlFor="plain_ip_notify_chk"
                                                            className="cursor-pointer text-sm"
                                                        >
                                                            {t("FullIPNotification")}
                                                        </Label>
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="grid gap-4 md:grid-cols-3">
                                    <FormField
                                        control={form.control}
                                        name="cover"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("Coverage")}</FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={`${field.value}`}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {Object.entries(
                                                            settingCoverageTypes,
                                                        ).map(([k, v]) => (
                                                            <SelectItem key={k} value={k}>
                                                                {v}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="ignored_ip_notification"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("SpecificServers") +
                                                        " " +
                                                        t("SeparateWithComma")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        placeholder="例如：1,2,3（留空代表不指定）"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="ip_change_notification_group_id"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("NotifierGroup")}</FormLabel>
                                                <FormControl>
                                                    <Combobox
                                                        placeholder={t("Search")}
                                                        options={ngroupList}
                                                        onValueChange={field.onChange}
                                                        defaultValue={field.value?.toString()}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </fieldset>
                        </CardContent>
                    </Card>

                    {/* 卡片 4：默认折叠的高级开发者选项（使用原生 details 保证无障碍与测试可达） */}
                    <Card>
                        <details className="group">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 select-none">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-base font-semibold">
                                        <Wrench className="h-4 w-4 text-muted-foreground" />
                                        <span>四、高级与开发者选项（单人自用无需修改，点击展开）</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        包含自定义代码注入、第三方登录域名、多人内网穿透 (NAT) 域名、DDNS 自定义 DNS 与 MCP 接口等极少用到的进阶配置。
                                    </p>
                                </div>
                                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                            </summary>

                            <CardContent className="space-y-4 border-t pt-4">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <FormField
                                        control={form.control}
                                        name="dashboard_host"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("DashboardHost")}</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        placeholder="panel.example.com"
                                                        autoCorrect="off"
                                                        autoCapitalize="none"
                                                        spellCheck={false}
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormDescription className="text-xs">
                                                    {t("DashboardHostHint")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="dns_servers"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("CustomPublicDNSNameserversforDDNS") +
                                                        " " +
                                                        t("SeparateWithComma")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        placeholder="例如：1.1.1.1,8.8.8.8（留空使用系统默认）"
                                                        autoCorrect="off"
                                                        autoCapitalize="none"
                                                        spellCheck={false}
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <FormField
                                        control={form.control}
                                        name="reserved_hosts"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("ReservedHosts")}</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        autoCorrect="off"
                                                        autoCapitalize="none"
                                                        spellCheck={false}
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormDescription className="text-xs">
                                                    {t("ReservedHostsHint")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="nat_member_domains"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("NATMemberDomains")}</FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        placeholder="tunnel.example.com"
                                                        rows={3}
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormDescription className="text-xs">
                                                    {t("NATMemberDomainsHint")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="enable_mcp"
                                    render={({ field }) => (
                                        <FormItem className="rounded-lg border p-3">
                                            <FormControl>
                                                <div className="flex items-center gap-2">
                                                    <Checkbox
                                                        id="enable_mcp_chk"
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                    />
                                                    <Label
                                                        htmlFor="enable_mcp_chk"
                                                        className="cursor-pointer text-sm"
                                                    >
                                                        {t("EnableMCP")}
                                                    </Label>
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid gap-4 md:grid-cols-2">
                                    <FormField
                                        control={form.control}
                                        name="custom_code"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("CustomCodes")}</FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        className="min-h-32 resize-y font-mono text-xs"
                                                        placeholder="<!-- 无需手写，推荐直接使用『主题增强』可视化设置 -->"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="custom_code_dashboard"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("CustomCodesDashboard")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        className="min-h-32 resize-y font-mono text-xs"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </CardContent>
                        </details>
                    </Card>

                    <div className="flex items-center justify-end gap-3 pt-1">
                        <Button type="submit" size="lg" className="min-w-36">
                            {t("Confirm")}
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    )
}
