import { createNotification, updateNotification } from "@/api/notification"
import { createNotificationGroup, getNotificationGroups } from "@/api/notification-group"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { IconButton } from "@/components/xui/icon-button"
import { useNotificationStore } from "@/hooks/useNotificationStore"
import {
    INITIAL_WIZARD_INPUTS,
    MESSAGE_PLACEHOLDERS,
    NOTIFIER_PRESETS,
    type NotifierPresetId,
    type WizardInputs,
    buildNotificationFromPreset,
    detectNotifierPlatform,
} from "@/lib/notification-presets"
import { asOptionalField } from "@/lib/utils"
import { ModelNotification, nrequestMethods, nrequestTypes } from "@/types"
import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronDown, Sparkles, Wand2 } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { KeyedMutator } from "swr"
import { z } from "zod"

import { Textarea } from "./ui/textarea"

interface NotifierCardProps {
    data?: ModelNotification
    mutate: KeyedMutator<ModelNotification[]>
}

const notificationFormSchema = z.object({
    name: z.string().min(1, "请填写一个容易辨认的渠道名称"),
    url: z.string().url("请先填写上方密钥/Webhook 地址以生成有效 URL"),
    request_method: z.coerce.number().int().min(1).max(255),
    request_type: z.coerce.number().int().min(1).max(255),
    request_header: z.string(),
    request_body: z.string(),
    verify_tls: asOptionalField(z.boolean()),
    skip_check: asOptionalField(z.boolean()),
    format_metric_units: asOptionalField(z.boolean()),
})

const PRESET_DEFAULT_NAMES = new Set(
    NOTIFIER_PRESETS.map((p) => buildNotificationFromPreset(p.id, INITIAL_WIZARD_INPUTS)?.defaultName).filter(
        Boolean,
    ),
)

export const NotifierCard: React.FC<NotifierCardProps> = ({ data, mutate }) => {
    const { t } = useTranslation()
    const setNotifierGroup = useNotificationStore((s) => s.setNotifierGroup)
    const isEdit = Boolean(data?.id)

    type NotificationFormInput = z.input<typeof notificationFormSchema>
    type NotificationFormData = z.output<typeof notificationFormSchema>
    type NotificationDefaults = ModelNotification &
        Partial<Pick<NotificationFormData, "skip_check">>
    const notificationDefaults: NotificationDefaults | undefined = data

    const initialBuilt = buildNotificationFromPreset("telegram", INITIAL_WIZARD_INPUTS)!

    const form = useForm<NotificationFormInput, unknown, NotificationFormData>({
        resolver: zodResolver(notificationFormSchema),
        defaultValues: data
            ? {
                  name: data.name ?? "",
                  url: data.url ?? "",
                  request_method: data.request_method ?? 1,
                  request_type: data.request_type ?? 1,
                  request_header: data.request_header ?? "",
                  request_body: data.request_body ?? "",
                  verify_tls: data.verify_tls ?? true,
                  skip_check: notificationDefaults?.skip_check ?? false,
                  format_metric_units: data.format_metric_units ?? true,
              }
            : {
                  name: initialBuilt.defaultName,
                  url: "",
                  request_method: 2,
                  request_type: 1,
                  request_header: "",
                  request_body: initialBuilt.request_body,
                  verify_tls: true,
                  skip_check: false,
                  format_metric_units: true,
              },
        resetOptions: {
            keepDefaultValues: false,
        },
    })

    const [open, setOpen] = useState(false)
    const [selectedPreset, setSelectedPreset] = useState<NotifierPresetId>(
        isEdit ? "custom" : "telegram",
    )
    const [wizard, setWizard] = useState<WizardInputs>(INITIAL_WIZARD_INPUTS)
    const [autoCreateGroup, setAutoCreateGroup] = useState(!isEdit)

    const applyWizardSync = (nextPreset: NotifierPresetId, nextWizard: WizardInputs) => {
        const built = buildNotificationFromPreset(nextPreset, nextWizard)
        if (!built) return
        const curName = (form.getValues("name") || "").trim()
        if (!curName || PRESET_DEFAULT_NAMES.has(curName)) {
            form.setValue("name", built.defaultName, { shouldValidate: false })
        }
        form.setValue("url", built.url, { shouldValidate: Boolean(built.url) })
        form.setValue("request_method", built.request_method)
        form.setValue("request_type", built.request_type)
        form.setValue("request_header", built.request_header)
        form.setValue("request_body", built.request_body)
        form.setValue("verify_tls", built.verify_tls)
    }

    const handleSelectPreset = (preset: NotifierPresetId) => {
        setSelectedPreset(preset)
        if (preset !== "custom") {
            applyWizardSync(preset, wizard)
        }
    }

    const updateWizardField = <K extends keyof WizardInputs>(key: K, val: WizardInputs[K]) => {
        const next = { ...wizard, [key]: val }
        setWizard(next)
        if (selectedPreset !== "custom") {
            applyWizardSync(selectedPreset, next)
        }
    }

    const insertPlaceholder = (token: string) => {
        const cur = form.getValues("request_body") || ""
        form.setValue("request_body", cur ? `${cur}\n${token}` : token, { shouldDirty: true })
    }

    const onSubmit = async (values: NotificationFormData) => {
        try {
            if (data?.id) {
                await updateNotification(data.id, values)
                toast.success("推送渠道已更新")
            } else {
                const newId = await createNotification(values)
                if (autoCreateGroup && typeof newId === "number" && newId > 0) {
                    try {
                        await createNotificationGroup({
                            name: `${values.name}分组`,
                            notifications: [newId],
                        })
                        const groups = await getNotificationGroups()
                        setNotifierGroup(groups)
                        toast.success(
                            `推送渠道创建成功，并已自动建好「${values.name}分组」！`,
                        )
                    } catch {
                        toast.success("推送渠道创建成功（可前往第 2 步添加到通知分组）")
                    }
                } else {
                    toast.success("推送渠道创建成功")
                }
            }
        } catch (e) {
            console.error(e)
            toast(t("Error"), {
                description:
                    "保存或发送测试消息失败：请检查 Token / Webhook 地址是否正确，以及面板服务器网络能否连通该平台。",
            })
            return
        }
        setOpen(false)
        await mutate()
        form.reset()
    }

    const detectedExisting = isEdit
        ? detectNotifierPlatform(data?.url, data?.request_body)
        : null

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {data ? (
                    <IconButton variant="outline" icon="edit" />
                ) : (
                    <Button size="sm" className="gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" />
                        添加推送渠道
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
                <ScrollArea className="max-h-[calc(100dvh-5rem)] p-3">
                    <div className="mx-1 items-center">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Wand2 className="h-4 w-4 text-primary" />
                                <span>
                                    {data ? "编辑推送渠道" : "添加推送渠道（小白一键向导）"}
                                </span>
                                {detectedExisting && (
                                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                        当前类型：{detectedExisting.label}
                                    </span>
                                )}
                            </DialogTitle>
                            <DialogDescription className="text-xs">
                                选择你常用的接收软件，只需填入机器人 Token 或 Webhook 链接，底层请求格式会自动帮你生成好！
                            </DialogDescription>
                        </DialogHeader>

                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="my-3 space-y-4"
                            >
                                {/* 第 1 区：一键选择平台模板 */}
                                <fieldset className="space-y-2.5 rounded-lg border bg-muted/20 p-3">
                                    <legend className="px-1.5 text-xs font-semibold">
                                        1. 选择你想把消息发到哪里
                                    </legend>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                                        {NOTIFIER_PRESETS.map((p) => {
                                            const active = selectedPreset === p.id
                                            return (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    onClick={() => handleSelectPreset(p.id)}
                                                    className={`flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                                                        active
                                                            ? "border-primary bg-primary/10 shadow-xs"
                                                            : "border-border/70 bg-background hover:bg-muted/60"
                                                    }`}
                                                >
                                                    <div className="flex w-full items-center justify-between gap-1">
                                                        <span className="truncate text-xs font-semibold">
                                                            {p.label.split(" ")[0]}
                                                        </span>
                                                        <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                                                            {p.badge}
                                                        </span>
                                                    </div>
                                                    <span className="line-clamp-1 text-[10px] text-muted-foreground">
                                                        {p.recommended ? "★ 新手首选" : p.label}
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </fieldset>

                                {/* 渠道名称 */}
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>2. 给这个渠道起个名字</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="例如：我的 Telegram 机器人"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* 第 2 区：按所选平台展示超简填空向导 */}
                                {selectedPreset === "telegram" && (
                                    <div className="space-y-3 rounded-lg border border-blue-500/25 bg-blue-500/5 p-3.5">
                                        <div className="text-xs leading-relaxed text-muted-foreground">
                                            💡 <strong>两步获取参数</strong>：① 在 Telegram 搜索{" "}
                                            <code>@BotFather</code> 发送 <code>/newbot</code> 拿到{" "}
                                            <strong>Bot Token</strong>（记得先给你的新机器人点一下 Start！）；② 搜索{" "}
                                            <code>@userinfobot</code> 发任意消息拿到你的数字{" "}
                                            <strong>Chat ID</strong>。
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <div className="space-y-1">
                                                <Label className="text-xs">
                                                    机器人 Bot Token *
                                                </Label>
                                                <Input
                                                    placeholder="例如：123456789:AAHxyz..."
                                                    autoCorrect="off"
                                                    autoCapitalize="none"
                                                    spellCheck={false}
                                                    value={wizard.tgToken}
                                                    onChange={(e) =>
                                                        updateWizardField(
                                                            "tgToken",
                                                            e.target.value,
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">
                                                    接收人或群组 Chat ID *
                                                </Label>
                                                <Input
                                                    placeholder="例如：987654321 或 -100123456"
                                                    autoCorrect="off"
                                                    autoCapitalize="none"
                                                    spellCheck={false}
                                                    value={wizard.tgChatId}
                                                    onChange={(e) =>
                                                        updateWizardField(
                                                            "tgChatId",
                                                            e.target.value,
                                                        )
                                                    }
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">
                                                Telegram API 接口地址（海外服务器保持默认即可，国内面板可换反代地址）
                                            </Label>
                                            <Input
                                                placeholder="https://api.telegram.org"
                                                autoCorrect="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                value={wizard.tgEndpoint}
                                                onChange={(e) =>
                                                    updateWizardField(
                                                        "tgEndpoint",
                                                        e.target.value,
                                                    )
                                                }
                                            />
                                        </div>
                                    </div>
                                )}

                                {selectedPreset === "bark" && (
                                    <div className="space-y-2.5 rounded-lg border border-sky-500/25 bg-sky-500/5 p-3.5">
                                        <div className="text-xs text-muted-foreground">
                                            💡 在 iPhone / iPad App Store 下载免费的{" "}
                                            <strong>Bark</strong>，打开软件复制你的专属 Key（或整段{" "}
                                            <code>https://api.day.app/xxx</code> 链接）粘贴到下方即可。
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">
                                                Bark 推送 Key 或完整链接 *
                                            </Label>
                                            <Input
                                                placeholder="例如：aBcDeFgHiJkLmN 或 https://api.day.app/aBcDeFgHiJkLmN"
                                                autoCorrect="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                value={wizard.barkKeyOrUrl}
                                                onChange={(e) =>
                                                    updateWizardField(
                                                        "barkKeyOrUrl",
                                                        e.target.value,
                                                    )
                                                }
                                            />
                                        </div>
                                    </div>
                                )}

                                {(selectedPreset === "wecom" ||
                                    selectedPreset === "feishu" ||
                                    selectedPreset === "dingtalk" ||
                                    selectedPreset === "discord") && (
                                    <div className="space-y-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3.5">
                                        <div className="text-xs text-muted-foreground">
                                            {selectedPreset === "wecom" &&
                                                "💡 在企业微信群设置 → 添加群机器人 → 复制生成的 Webhook 地址粘贴到下方即可。"}
                                            {selectedPreset === "feishu" &&
                                                "💡 在飞书群设置 → 群机器人 → 添加『自定义机器人』 → 复制 Webhook 地址粘贴到下方即可。"}
                                            {selectedPreset === "dingtalk" &&
                                                "💡 在钉钉群设置 → 智能群助手 → 添加自定义机器人，安全设置勾选『自定义关键词』并填入「探针」，复制 Webhook 粘贴到下方。"}
                                            {selectedPreset === "discord" &&
                                                "💡 在 Discord 频道设置 → 整合 (Integrations) → Webhooks → 新建并复制 Webhook URL 粘贴到下方。"}
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Webhook 完整地址 *</Label>
                                            <Input
                                                placeholder="https://..."
                                                autoCorrect="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                value={wizard.webhookUrl}
                                                onChange={(e) =>
                                                    updateWizardField(
                                                        "webhookUrl",
                                                        e.target.value,
                                                    )
                                                }
                                            />
                                        </div>
                                    </div>
                                )}

                                {selectedPreset === "serverchan" && (
                                    <div className="space-y-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3.5">
                                        <div className="text-xs text-muted-foreground">
                                            💡 微信扫码登录 <code>sct.ftqq.com</code>，复制你的{" "}
                                            <strong>SendKey</strong>（以 <code>SCT</code> 开头）填到下方即可在微信收到推送。
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Server酱 SendKey *</Label>
                                            <Input
                                                placeholder="例如：SCT123456Tabcdefg..."
                                                autoCorrect="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                value={wizard.sendKey}
                                                onChange={(e) =>
                                                    updateWizardField("sendKey", e.target.value)
                                                }
                                            />
                                        </div>
                                    </div>
                                )}

                                {selectedPreset === "pushplus" && (
                                    <div className="space-y-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3.5">
                                        <div className="text-xs text-muted-foreground">
                                            💡 微信登录 <code>pushplus.plus</code>，在一对一推送页面复制你的 32 位{" "}
                                            <strong>Token</strong> 填到下方即可。
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">PushPlus Token *</Label>
                                            <Input
                                                placeholder="粘贴 32 位 Token..."
                                                autoCorrect="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                value={wizard.pushplusToken}
                                                onChange={(e) =>
                                                    updateWizardField(
                                                        "pushplusToken",
                                                        e.target.value,
                                                    )
                                                }
                                            />
                                        </div>
                                    </div>
                                )}

                                {selectedPreset === "ntfy" && (
                                    <div className="space-y-2.5 rounded-lg border border-purple-500/25 bg-purple-500/5 p-3.5">
                                        <div className="text-xs text-muted-foreground">
                                            💡 手机安装开源 Ntfy App 并订阅一个独一无二的主题名，在下方填入完整地址（如{" "}
                                            <code>https://ntfy.sh/my-secret-nezha-888</code>）。
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Ntfy 订阅地址 *</Label>
                                            <Input
                                                placeholder="https://ntfy.sh/my-secret-nezha"
                                                autoCorrect="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                value={wizard.ntfyUrl}
                                                onChange={(e) =>
                                                    updateWizardField("ntfyUrl", e.target.value)
                                                }
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* 底层 HTTP 请求参数（自定义模式下直接展开，模板模式下默认折叠不吓人） */}
                                <details
                                    open={selectedPreset === "custom"}
                                    className="group rounded-lg border bg-background"
                                >
                                    <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-xs font-medium text-muted-foreground select-none hover:text-foreground">
                                        <span>
                                            {selectedPreset === "custom"
                                                ? "3. 填写自定义 Webhook 接口参数"
                                                : "查看 / 微调自动生成的底层接口参数与通知文案（一般无需修改）"}
                                        </span>
                                        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                                    </summary>

                                    <div className="space-y-3 border-t p-3.5">
                                        <FormField
                                            control={form.control}
                                            name="url"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>请求 URL</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            placeholder="https://..."
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

                                        <div className="grid grid-cols-2 gap-3">
                                            <FormField
                                                control={form.control}
                                                name="request_method"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t("RequestMethod")}
                                                        </FormLabel>
                                                        <Select
                                                            onValueChange={(v) =>
                                                                field.onChange(Number(v))
                                                            }
                                                            value={`${field.value}`}
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                {Object.entries(
                                                                    nrequestMethods,
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
                                                name="request_type"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>数据编码格式</FormLabel>
                                                        <Select
                                                            onValueChange={(v) =>
                                                                field.onChange(Number(v))
                                                            }
                                                            value={`${field.value}`}
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                {Object.entries(
                                                                    nrequestTypes,
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
                                        </div>

                                        <FormField
                                            control={form.control}
                                            name="request_header"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        自定义请求头 JSON（绝大多数留空即可）
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Textarea
                                                            rows={2}
                                                            className="resize-y font-mono text-xs"
                                                            placeholder='例如：{"Authorization":"Bearer xxx"}'
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="request_body"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <div className="flex flex-wrap items-center justify-between gap-1">
                                                        <FormLabel>
                                                            消息内容模板（点击右侧标签可插入变量）
                                                        </FormLabel>
                                                        <div className="flex flex-wrap gap-1">
                                                            {MESSAGE_PLACEHOLDERS.map((ph) => (
                                                                <button
                                                                    key={ph.token}
                                                                    type="button"
                                                                    onClick={() =>
                                                                        insertPlaceholder(ph.token)
                                                                    }
                                                                    className="rounded border bg-muted/60 px-1.5 py-0.5 text-[10px] hover:bg-muted"
                                                                    title={ph.token}
                                                                >
                                                                    + {ph.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <FormControl>
                                                        <Textarea
                                                            rows={5}
                                                            className="resize-y font-mono text-xs"
                                                            placeholder='{"text":"#NEZHA#"}'
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </details>

                                {form.formState.errors.url && selectedPreset !== "custom" && (
                                    <p className="text-xs font-medium text-destructive">
                                        {form.formState.errors.url.message}
                                    </p>
                                )}

                                {/* 贴心验证与一步建组选项 */}
                                <div className="space-y-2.5 rounded-lg border bg-muted/20 p-3">
                                    {!isEdit && (
                                        <div className="flex items-start gap-2">
                                            <Checkbox
                                                id="auto_create_group_chk"
                                                className="mt-0.5"
                                                checked={autoCreateGroup}
                                                onCheckedChange={(v) =>
                                                    setAutoCreateGroup(Boolean(v))
                                                }
                                            />
                                            <Label
                                                htmlFor="auto_create_group_chk"
                                                className="cursor-pointer text-xs font-medium leading-snug"
                                            >
                                                ⚡ 顺便自动创建同名「通知分组」并绑定（推荐！一步到位，省去再手动建分组）
                                            </Label>
                                        </div>
                                    )}

                                    <FormField
                                        control={form.control}
                                        name="skip_check"
                                        render={({ field }) => (
                                            <FormItem className="flex items-start space-x-0">
                                                <FormControl>
                                                    <div className="flex items-start gap-2">
                                                        <Checkbox
                                                            id="send_test_msg_chk"
                                                            className="mt-0.5"
                                                            checked={!field.value}
                                                            onCheckedChange={(checked) =>
                                                                field.onChange(!checked)
                                                            }
                                                        />
                                                        <Label
                                                            htmlFor="send_test_msg_chk"
                                                            className="cursor-pointer text-xs leading-snug"
                                                        >
                                                            保存时立即发送一条「测试消息」验证配置能否收到（收到提示音即代表大功告成！）
                                                        </Label>
                                                    </div>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />

                                    <div className="flex flex-wrap gap-4 pt-1">
                                        <FormField
                                            control={form.control}
                                            name="format_metric_units"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center space-x-0">
                                                    <FormControl>
                                                        <div className="flex items-center gap-2">
                                                            <Checkbox
                                                                id="fmt_units_chk"
                                                                checked={field.value === true}
                                                                onCheckedChange={field.onChange}
                                                            />
                                                            <Label
                                                                htmlFor="fmt_units_chk"
                                                                className="cursor-pointer text-xs text-muted-foreground"
                                                            >
                                                                自动把数值转为 GB/MB 易读单位
                                                            </Label>
                                                        </div>
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="verify_tls"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center space-x-0">
                                                    <FormControl>
                                                        <div className="flex items-center gap-2">
                                                            <Checkbox
                                                                id="verify_tls_chk"
                                                                checked={field.value === true}
                                                                onCheckedChange={field.onChange}
                                                            />
                                                            <Label
                                                                htmlFor="verify_tls_chk"
                                                                className="cursor-pointer text-xs text-muted-foreground"
                                                            >
                                                                验证对方 HTTPS 安全证书
                                                            </Label>
                                                        </div>
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                <DialogFooter className="justify-end gap-2 pt-1">
                                    <DialogClose asChild>
                                        <Button type="button" variant="secondary">
                                            {t("Close")}
                                        </Button>
                                    </DialogClose>
                                    <Button type="submit">{t("Confirm")}</Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}
