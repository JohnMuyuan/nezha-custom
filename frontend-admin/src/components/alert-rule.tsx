import { createAlertRule, updateAlertRule } from "@/api/alert-rule"
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
import { MultiSelect } from "@/components/xui/multi-select"
import { useNotification } from "@/hooks/useNotfication"
import { useServer } from "@/hooks/useServer"
import { ALERT_METRIC_OPTIONS, formatHumanBytes } from "@/lib/notification-presets"
import { conv } from "@/lib/utils"
import { ModelAlertRule } from "@/types"
import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronDown, Plus, ShieldPlus, Trash2, Wand2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { KeyedMutator } from "swr"
import { z } from "zod"

import { Textarea } from "./ui/textarea"

interface AlertRuleCardProps {
    data?: ModelAlertRule
    mutate: KeyedMutator<ModelAlertRule[]>
}

const cycleUnitSchema = z.enum(["hour", "day", "week", "month", "year"])

const ruleSchema = z.object({
    type: z.string().min(1, "请选择监控指标"),
    min: z.number().optional(),
    max: z.number().optional(),
    cycle_start: z.string().optional(),
    cycle_interval: z.number().optional(),
    cycle_unit: cycleUnitSchema.optional(),
    duration: z.number().optional(),
    cover: z.number().int().min(0),
    ignore: z.record(z.string(), z.boolean()).optional(),
    next_transfer_at: z.record(z.string(), z.string()).optional(),
    last_cycle_status: z.boolean().optional(),
})

type AlertRuleEntry = z.output<typeof ruleSchema>

const alertRuleFormSchema = z.object({
    name: z.string().min(1, "请填写规则名称"),
    rules_raw: z.string().refine(
        (val) => {
            try {
                const parsed = JSON.parse(val)
                return Array.isArray(parsed) && parsed.length > 0
            } catch {
                return false
            }
        },
        {
            message: "请至少配置 1 条有效的触发条件",
        },
    ),
    rules: z.array(ruleSchema),
    fail_trigger_tasks: z.array(z.number()),
    fail_trigger_tasks_raw: z.string(),
    recover_trigger_tasks: z.array(z.number()),
    recover_trigger_tasks_raw: z.string(),
    notification_group_id: z.coerce.number().int().min(0),
    trigger_mode: z.coerce.number().int().min(0),
    enable: z.boolean().optional(),
})

interface AlertScenarioPreset {
    id: string
    badge: string
    name: string
    desc: string
    rules: AlertRuleEntry[]
}

const ALERT_SCENARIO_PRESETS: AlertScenarioPreset[] = [
    {
        id: "offline",
        badge: "🔴 离线必开",
        name: "服务器离线掉线提醒",
        desc: "失联满 60 秒发通知",
        rules: [{ type: "offline", duration: 60, cover: 0 }],
    },
    {
        id: "cpu",
        badge: "🔥 CPU 跑满",
        name: "CPU 持续高占用告警",
        desc: "CPU > 90% 持续 3 分钟",
        rules: [{ type: "cpu", max: 90, duration: 180, cover: 0 }],
    },
    {
        id: "memory",
        badge: "💾 内存告急",
        name: "内存不足告警",
        desc: "内存 > 90% 持续 2 分钟",
        rules: [{ type: "memory", max: 90, duration: 120, cover: 0 }],
    },
    {
        id: "disk",
        badge: "💿 硬盘快满",
        name: "硬盘空间不足告警",
        desc: "硬盘 > 85% 持续 5 分钟",
        rules: [{ type: "disk", max: 85, duration: 300, cover: 0 }],
    },
    {
        id: "temp",
        badge: "🌡️ 温度过高",
        name: "硬件高温告警",
        desc: "温度 > 80℃ 持续 2 分钟",
        rules: [{ type: "temperature_max", max: 80, duration: 120, cover: 0 }],
    },
]

const PRESET_NAMES = new Set(ALERT_SCENARIO_PRESETS.map((p) => p.name))

const SPEED_QUICK_PRESETS = [
    { label: "10 Mbps", bytes: 1_250_000 },
    { label: "50 Mbps", bytes: 6_250_000 },
    { label: "100 Mbps", bytes: 12_500_000 },
    { label: "500 Mbps", bytes: 62_500_000 },
    { label: "1 Gbps", bytes: 125_000_000 },
]

const TRAFFIC_QUICK_PRESETS = [
    { label: "100 GB", bytes: 100 * 1024 ** 3 },
    { label: "500 GB", bytes: 500 * 1024 ** 3 },
    { label: "1 TB", bytes: 1024 ** 4 },
    { label: "2 TB", bytes: 2 * 1024 ** 4 },
    { label: "5 TB", bytes: 5 * 1024 ** 4 },
]

const DURATION_QUICK_PRESETS = [
    { label: "15秒", sec: 15 },
    { label: "1分钟", sec: 60 },
    { label: "3分钟", sec: 180 },
    { label: "5分钟", sec: 300 },
]

function buildMonthStartRFC3339(): string {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const offsetMin = -now.getTimezoneOffset()
    const sign = offsetMin >= 0 ? "+" : "-"
    const hh = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, "0")
    const mm = String(Math.abs(offsetMin) % 60).padStart(2, "0")
    return `${y}-${m}-01T00:00:00${sign}${hh}:${mm}`
}

export const AlertRuleCard: React.FC<AlertRuleCardProps> = ({ data, mutate }) => {
    const { t } = useTranslation()
    const isEdit = Boolean(data?.id)

    const { notifierGroup } = useNotification()
    const { servers } = useServer()

    const defaultOfflineRule: AlertRuleEntry[] = [{ type: "offline", duration: 60, cover: 0 }]

    type AlertRuleFormInput = z.input<typeof alertRuleFormSchema>
    type AlertRuleFormData = z.output<typeof alertRuleFormSchema>

    const form = useForm<AlertRuleFormInput, unknown, AlertRuleFormData>({
        resolver: zodResolver(alertRuleFormSchema),
        defaultValues: data
            ? {
                  ...data,
                  rules_raw: JSON.stringify(data.rules),
                  fail_trigger_tasks_raw: conv.arrToStr(data.fail_trigger_tasks),
                  recover_trigger_tasks_raw: conv.arrToStr(data.recover_trigger_tasks),
              }
            : {
                  name: ALERT_SCENARIO_PRESETS[0].name,
                  rules_raw: JSON.stringify(defaultOfflineRule),
                  rules: defaultOfflineRule,
                  fail_trigger_tasks: [],
                  fail_trigger_tasks_raw: "",
                  recover_trigger_tasks: [],
                  recover_trigger_tasks_raw: "",
                  notification_group_id: notifierGroup?.[0]?.group.id ?? 0,
                  trigger_mode: 1,
                  enable: true,
              },
        resetOptions: {
            keepDefaultValues: false,
        },
    })

    const [open, setOpen] = useState(false)
    const [presetEpoch, setPresetEpoch] = useState(0)

    const initialRules = (() => {
        try {
            if (data?.rules?.length) return data.rules
            const raw = form.getValues("rules_raw")
            if (!raw) return defaultOfflineRule
            const parsed: unknown = JSON.parse(raw)
            return z.array(ruleSchema).parse(parsed)
        } catch {
            return defaultOfflineRule
        }
    })()

    const [rulesUI, setRulesUI] = useState<AlertRuleEntry[]>(initialRules)

    useEffect(() => {
        try {
            form.setValue("rules_raw", JSON.stringify(rulesUI), { shouldDirty: true })
        } catch {
            // ignore
        }
    }, [form, rulesUI])

    useEffect(() => {
        if (!isEdit && notifierGroup?.length && Number(form.getValues("notification_group_id")) === 0) {
            form.setValue("notification_group_id", notifierGroup[0].group.id)
        }
    }, [form, isEdit, notifierGroup])

    const rulesRaw = useWatch({ control: form.control, name: "rules_raw" })
    const watchedGroupId = useWatch({ control: form.control, name: "notification_group_id" })

    const applyScenarioPreset = (preset: AlertScenarioPreset) => {
        const curName = (form.getValues("name") || "").trim()
        if (!curName || PRESET_NAMES.has(curName)) {
            form.setValue("name", preset.name, { shouldDirty: true })
        }
        const cloned = preset.rules.map((item) => ({ ...item }))
        setRulesUI(cloned)
        form.setValue("trigger_mode", 1)
        form.setValue("enable", true)
        if (Number(form.getValues("notification_group_id")) === 0 && notifierGroup?.length) {
            form.setValue("notification_group_id", notifierGroup[0].group.id)
        }
        setPresetEpoch((n) => n + 1)
    }

    const onSubmit = async (values: AlertRuleFormData) => {
        try {
            values.rules = z.array(ruleSchema).parse(JSON.parse(values.rules_raw))
        } catch {
            toast(t("Error"), {
                description: "规则条件不完整，请先为每条规则选择监控指标。",
            })
            return
        }
        values.fail_trigger_tasks = conv.strToArr(values.fail_trigger_tasks_raw).map(Number)
        values.recover_trigger_tasks = conv.strToArr(values.recover_trigger_tasks_raw).map(Number)
        const requiredFields = { ...values }
        delete (requiredFields as Record<string, unknown>).rules_raw
        try {
            if (data?.id) {
                await updateAlertRule(data.id, requiredFields)
                toast.success("警报规则已更新")
            } else {
                await createAlertRule(requiredFields)
                toast.success("警报规则已创建并生效")
            }
        } catch (e) {
            console.error(e)
            toast(t("Error"), {
                description: t("Results.UnExpectedError"),
            })
            return
        }
        setOpen(false)
        await mutate()
    }

    const serverOptions =
        servers?.map((s) => ({
            value: String(s.id),
            label: `${s.name} (#${s.id})`,
        })) || []

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {data ? (
                    <IconButton variant="outline" icon="edit" />
                ) : (
                    <Button size="sm" className="gap-1.5">
                        <ShieldPlus className="h-3.5 w-3.5" />
                        新建警报规则
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
                <ScrollArea className="max-h-[calc(100dvh-5rem)] p-3">
                    <div className="mx-1 items-center">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Wand2 className="h-4 w-4 text-primary" />
                                <span>{data ? "编辑警报规则" : "新建警报规则（小白可视化向导）"}</span>
                            </DialogTitle>
                            <DialogDescription className="text-xs">
                                点一下常用场景即可自动填好推荐参数，选择接收通知分组并保存即可生效。
                            </DialogDescription>
                        </DialogHeader>

                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="my-3 space-y-4"
                            >
                                {/* 一键常用警报模板 */}
                                <fieldset className="space-y-2 rounded-lg border bg-muted/20 p-3">
                                    <legend className="px-1.5 text-xs font-semibold">
                                        ⚡ 一键套用常见告警模板（点选自动填好参数）
                                    </legend>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                                        {ALERT_SCENARIO_PRESETS.map((preset) => (
                                            <button
                                                key={preset.id}
                                                type="button"
                                                onClick={() => applyScenarioPreset(preset)}
                                                className="flex flex-col items-start gap-0.5 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
                                            >
                                                <span className="text-xs font-semibold">
                                                    {preset.badge}
                                                </span>
                                                <span className="line-clamp-1 text-[10px] text-muted-foreground">
                                                    {preset.desc}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </fieldset>

                                {/* 规则名称 */}
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>1. 规则名称</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="例如：服务器离线掉线提醒"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* 结构化触发条件编辑器 */}
                                <div className="space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-sm font-medium">
                                            2. 触发条件（满足条件时发送告警）
                                        </Label>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 gap-1 text-xs"
                                            onClick={() => {
                                                setRulesUI([
                                                    ...rulesUI,
                                                    { type: "cpu", max: 90, cover: 0, duration: 60 },
                                                ])
                                                setPresetEpoch((n) => n + 1)
                                            }}
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            叠加条件
                                        </Button>
                                    </div>

                                    {rulesUI.map((r, idx) => {
                                        const isCycle =
                                            typeof r.type === "string" && r.type.endsWith("_cycle")
                                        const isOffline = r.type === "offline"
                                        const meta = ALERT_METRIC_OPTIONS.find(
                                            (m) => m.value === r.type,
                                        )
                                        const selectedServerIds = Object.entries(r.ignore || {})
                                            .filter(([, v]) => Boolean(v))
                                            .map(([k]) => k)
                                        const isKnownMetric = Boolean(meta) || !r.type

                                        return (
                                            <div
                                                key={`${presetEpoch}-${idx}`}
                                                className="space-y-3 rounded-lg border bg-card p-3.5 shadow-2xs"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-semibold text-primary">
                                                        条件 #{idx + 1}
                                                    </span>
                                                    {rulesUI.length > 1 && (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                                                            onClick={() => {
                                                                const next = [...rulesUI]
                                                                next.splice(idx, 1)
                                                                setRulesUI(next)
                                                                setPresetEpoch((n) => n + 1)
                                                            }}
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                            删除此条件
                                                        </Button>
                                                    )}
                                                </div>

                                                {/* 监控指标与持续秒数 */}
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">
                                                            监控什么指标
                                                        </Label>
                                                        <Select
                                                            value={r.type || ""}
                                                            onValueChange={(val) => {
                                                                const next = [...rulesUI]
                                                                const nextRule: AlertRuleEntry = {
                                                                    ...next[idx],
                                                                    type: val,
                                                                }
                                                                if (!val.endsWith("_cycle")) {
                                                                    delete nextRule.cycle_start
                                                                    delete nextRule.cycle_interval
                                                                    delete nextRule.cycle_unit
                                                                } else {
                                                                    nextRule.cycle_start =
                                                                        nextRule.cycle_start ||
                                                                        buildMonthStartRFC3339()
                                                                    nextRule.cycle_interval =
                                                                        nextRule.cycle_interval || 1
                                                                    nextRule.cycle_unit =
                                                                        nextRule.cycle_unit ||
                                                                        "month"
                                                                }
                                                                if (val === "offline") {
                                                                    delete nextRule.min
                                                                    delete nextRule.max
                                                                    nextRule.duration =
                                                                        nextRule.duration || 60
                                                                }
                                                                next[idx] = nextRule
                                                                setRulesUI(next)
                                                            }}
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="请选择监控项目..." />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {!isKnownMetric && (
                                                                    <SelectItem value={r.type}>
                                                                        {r.type}
                                                                    </SelectItem>
                                                                )}
                                                                {ALERT_METRIC_OPTIONS.map((opt) => (
                                                                    <SelectItem
                                                                        key={opt.value}
                                                                        value={opt.value}
                                                                    >
                                                                        {opt.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    {!isCycle && (
                                                        <div className="space-y-1">
                                                            <div className="flex items-center justify-between">
                                                                <Label className="text-xs">
                                                                    持续多久才报警（秒）
                                                                </Label>
                                                                <div className="flex gap-1">
                                                                    {DURATION_QUICK_PRESETS.map(
                                                                        (dp) => (
                                                                            <button
                                                                                key={dp.sec}
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    const next = [
                                                                                        ...rulesUI,
                                                                                    ]
                                                                                    next[idx] = {
                                                                                        ...next[
                                                                                            idx
                                                                                        ],
                                                                                        duration:
                                                                                            dp.sec,
                                                                                    }
                                                                                    setRulesUI(next)
                                                                                }}
                                                                                className="rounded border bg-muted/60 px-1.5 py-0.5 text-[10px] hover:bg-muted"
                                                                            >
                                                                                {dp.label}
                                                                            </button>
                                                                        ),
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <Input
                                                                type="number"
                                                                min={1}
                                                                value={r.duration ?? ""}
                                                                onChange={(e) => {
                                                                    const next = [...rulesUI]
                                                                    next[idx] = {
                                                                        ...next[idx],
                                                                        duration: e.target.value
                                                                            ? Number(e.target.value)
                                                                            : undefined,
                                                                    }
                                                                    setRulesUI(next)
                                                                }}
                                                                placeholder="60"
                                                            />
                                                        </div>
                                                    )}
                                                </div>

                                                {meta?.hint && (
                                                    <p className="text-[11px] text-muted-foreground">
                                                        💡 {meta.hint}
                                                    </p>
                                                )}

                                                {/* 阈值设置（离线规则不需要阈值） */}
                                                {!isOffline && (
                                                    <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
                                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                            <div className="space-y-1">
                                                                <div className="flex items-center justify-between gap-1">
                                                                    <Label className="text-xs font-medium">
                                                                        超过多少时报警（上限）
                                                                        {meta?.unit
                                                                            ? ` [${meta.unit}]`
                                                                            : ""}
                                                                    </Label>
                                                                    {(meta?.unit === "B" ||
                                                                        meta?.unit === "B/s") &&
                                                                        r.max && (
                                                                            <span className="text-[11px] font-semibold text-primary">
                                                                                ≈{" "}
                                                                                {formatHumanBytes(
                                                                                    r.max,
                                                                                )}
                                                                                {meta.unit === "B/s"
                                                                                    ? "/s"
                                                                                    : ""}
                                                                            </span>
                                                                        )}
                                                                </div>
                                                                <Input
                                                                    type="number"
                                                                    value={r.max ?? ""}
                                                                    onChange={(e) => {
                                                                        const next = [...rulesUI]
                                                                        next[idx] = {
                                                                            ...next[idx],
                                                                            max: e.target.value
                                                                                ? Number(
                                                                                      e.target
                                                                                          .value,
                                                                                  )
                                                                                : undefined,
                                                                        }
                                                                        setRulesUI(next)
                                                                    }}
                                                                    placeholder={
                                                                        meta?.unit === "%"
                                                                            ? "例如：90"
                                                                            : "留空代表不限上限"
                                                                    }
                                                                />
                                                            </div>

                                                            <div className="space-y-1">
                                                                <Label className="text-xs text-muted-foreground">
                                                                    低于多少时报警（下限，一般留空）
                                                                </Label>
                                                                <Input
                                                                    type="number"
                                                                    value={r.min ?? ""}
                                                                    onChange={(e) => {
                                                                        const next = [...rulesUI]
                                                                        next[idx] = {
                                                                            ...next[idx],
                                                                            min: e.target.value
                                                                                ? Number(
                                                                                      e.target
                                                                                          .value,
                                                                                  )
                                                                                : undefined,
                                                                        }
                                                                        setRulesUI(next)
                                                                    }}
                                                                    placeholder="留空即可"
                                                                />
                                                            </div>
                                                        </div>

                                                        {/* 百分比 / 网速 / 流量 快捷换算按钮 */}
                                                        {meta?.unit === "%" && (
                                                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                                                <span className="text-[11px] text-muted-foreground">
                                                                    快捷上限：
                                                                </span>
                                                                {[80, 85, 90, 95].map((pct) => (
                                                                    <button
                                                                        key={pct}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            const next = [
                                                                                ...rulesUI,
                                                                            ]
                                                                            next[idx] = {
                                                                                ...next[idx],
                                                                                max: pct,
                                                                            }
                                                                            setRulesUI(next)
                                                                        }}
                                                                        className="rounded border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
                                                                    >
                                                                        {pct}%
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {meta?.unit === "B/s" && (
                                                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                                                <span className="text-[11px] text-muted-foreground">
                                                                    一键换算填入网速：
                                                                </span>
                                                                {SPEED_QUICK_PRESETS.map((sp) => (
                                                                    <button
                                                                        key={sp.label}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            const next = [
                                                                                ...rulesUI,
                                                                            ]
                                                                            next[idx] = {
                                                                                ...next[idx],
                                                                                max: sp.bytes,
                                                                            }
                                                                            setRulesUI(next)
                                                                        }}
                                                                        className="rounded border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
                                                                    >
                                                                        {sp.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {meta?.unit === "B" && (
                                                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                                                <span className="text-[11px] text-muted-foreground">
                                                                    一键换算填入流量：
                                                                </span>
                                                                {TRAFFIC_QUICK_PRESETS.map((tp) => (
                                                                    <button
                                                                        key={tp.label}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            const next = [
                                                                                ...rulesUI,
                                                                            ]
                                                                            next[idx] = {
                                                                                ...next[idx],
                                                                                max: tp.bytes,
                                                                            }
                                                                            setRulesUI(next)
                                                                        }}
                                                                        className="rounded border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
                                                                    >
                                                                        {tp.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* 周期流量专属设置 */}
                                                {isCycle && (
                                                    <div className="grid grid-cols-1 gap-2.5 rounded-md border border-amber-500/25 bg-amber-500/5 p-2.5 sm:grid-cols-3">
                                                        <div className="space-y-1 sm:col-span-3">
                                                            <div className="flex items-center justify-between">
                                                                <Label className="text-xs">
                                                                    周期计费起始时间
                                                                </Label>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const next = [...rulesUI]
                                                                        next[idx] = {
                                                                            ...next[idx],
                                                                            cycle_start:
                                                                                buildMonthStartRFC3339(),
                                                                        }
                                                                        setRulesUI(next)
                                                                    }}
                                                                    className="rounded border bg-background px-2 py-0.5 text-[10px] hover:bg-muted"
                                                                >
                                                                    设为本月 1 号零点
                                                                </button>
                                                            </div>
                                                            <Input
                                                                value={r.cycle_start ?? ""}
                                                                onChange={(e) => {
                                                                    const next = [...rulesUI]
                                                                    next[idx] = {
                                                                        ...next[idx],
                                                                        cycle_start:
                                                                            e.target.value ||
                                                                            undefined,
                                                                    }
                                                                    setRulesUI(next)
                                                                }}
                                                                placeholder="2026-01-01T00:00:00+08:00"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">
                                                                每隔几个周期重置
                                                            </Label>
                                                            <Input
                                                                type="number"
                                                                min={1}
                                                                value={r.cycle_interval ?? 1}
                                                                onChange={(e) => {
                                                                    const next = [...rulesUI]
                                                                    next[idx] = {
                                                                        ...next[idx],
                                                                        cycle_interval: e.target
                                                                            .value
                                                                            ? Number(e.target.value)
                                                                            : undefined,
                                                                    }
                                                                    setRulesUI(next)
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="space-y-1 sm:col-span-2">
                                                            <Label className="text-xs">
                                                                周期单位
                                                            </Label>
                                                            <Select
                                                                value={r.cycle_unit || "month"}
                                                                onValueChange={(val) => {
                                                                    const next = [...rulesUI]
                                                                    next[idx] = {
                                                                        ...next[idx],
                                                                        cycle_unit:
                                                                            cycleUnitSchema.parse(
                                                                                val,
                                                                            ),
                                                                    }
                                                                    setRulesUI(next)
                                                                }}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="month">
                                                                        按月 (Month)
                                                                    </SelectItem>
                                                                    <SelectItem value="year">
                                                                        按年 (Year)
                                                                    </SelectItem>
                                                                    <SelectItem value="week">
                                                                        按周 (Week)
                                                                    </SelectItem>
                                                                    <SelectItem value="day">
                                                                        按天 (Day)
                                                                    </SelectItem>
                                                                    <SelectItem value="hour">
                                                                        按小时 (Hour)
                                                                    </SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* 监控服务器范围 + 可视化小鸡多选器（彻底告别手写 JSON！） */}
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">
                                                            监控哪些服务器
                                                        </Label>
                                                        <Select
                                                            value={String(r.cover ?? 0)}
                                                            onValueChange={(val) => {
                                                                const next = [...rulesUI]
                                                                next[idx] = {
                                                                    ...next[idx],
                                                                    cover: Number(val),
                                                                }
                                                                setRulesUI(next)
                                                            }}
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="0">
                                                                    🌐 监控全部服务器（推荐）
                                                                </SelectItem>
                                                                <SelectItem value="1">
                                                                    🎯 仅监控指定的部分服务器
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    <div className="space-y-1">
                                                        <Label className="text-xs">
                                                            {(r.cover ?? 0) === 0
                                                                ? "排除不报警的机器（留空=全部监控）"
                                                                : "勾选需要监控的机器（必选）"}
                                                        </Label>
                                                        <MultiSelect
                                                            type="button"
                                                            modalPopover
                                                            options={serverOptions}
                                                            defaultValue={selectedServerIds}
                                                            placeholder={
                                                                (r.cover ?? 0) === 0
                                                                    ? "不排除任何机器"
                                                                    : "点击勾选目标服务器..."
                                                            }
                                                            onValueChange={(ids) => {
                                                                const next = [...rulesUI]
                                                                const ignoreMap: Record<
                                                                    string,
                                                                    boolean
                                                                > = {}
                                                                for (const id of ids) {
                                                                    ignoreMap[id] = true
                                                                }
                                                                next[idx] = {
                                                                    ...next[idx],
                                                                    ignore:
                                                                        ids.length > 0
                                                                            ? ignoreMap
                                                                            : undefined,
                                                                }
                                                                setRulesUI(next)
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>

                                {/* 接收通知分组 + 触发频率 */}
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <FormField
                                        control={form.control}
                                        name="notification_group_id"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>3. 把消息发给哪个通知分组</FormLabel>
                                                <Select
                                                    value={String(field.value ?? 0)}
                                                    onValueChange={(v) => field.onChange(Number(v))}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="请选择通知分组" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="0">
                                                            🔇 不发送通知（仅后台记录）
                                                        </SelectItem>
                                                        {notifierGroup?.map((ng) => (
                                                            <SelectItem
                                                                key={ng.group.id}
                                                                value={String(ng.group.id)}
                                                            >
                                                                📢 {ng.group.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                {(!notifierGroup || notifierGroup.length === 0) && (
                                                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                                        还没有通知分组？请先去{" "}
                                                        <Link
                                                            to="/dashboard/notification"
                                                            className="underline font-medium"
                                                        >
                                                            ① 推送渠道
                                                        </Link>{" "}
                                                        添加机器人（会自动创建分组）。
                                                    </p>
                                                )}
                                                {notifierGroup &&
                                                    notifierGroup.length > 0 &&
                                                    Number(watchedGroupId) === 0 && (
                                                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                                            ⚠️ 当前选择了「不发送通知」，如需手机/TG 收告警请选择你的通知分组。
                                                        </p>
                                                    )}
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="trigger_mode"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>4. 告警发送频率</FormLabel>
                                                <Select
                                                    value={String(field.value ?? 1)}
                                                    onValueChange={(v) => field.onChange(Number(v))}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="1">
                                                            🔕 每次故障仅发 1 次，恢复后再通知（推荐）
                                                        </SelectItem>
                                                        <SelectItem value="0">
                                                            🔔 故障期间持续重复发送（容易刷屏）
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {/* 立即启用开关 */}
                                <FormField
                                    control={form.control}
                                    name="enable"
                                    render={({ field }) => (
                                        <FormItem className="rounded-lg border bg-emerald-500/5 px-3.5 py-2.5">
                                            <FormControl>
                                                <div className="flex items-center gap-2.5">
                                                    <Checkbox
                                                        id="alert_rule_enable_chk"
                                                        checked={Boolean(field.value)}
                                                        onCheckedChange={field.onChange}
                                                    />
                                                    <Label
                                                        htmlFor="alert_rule_enable_chk"
                                                        className="cursor-pointer text-xs font-semibold"
                                                    >
                                                        ✅ 立即启用这条警报规则
                                                    </Label>
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* 高级自愈任务与原始 JSON（默认折叠，保持界面清爽） */}
                                <details className="group rounded-lg border bg-background">
                                    <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-xs font-medium text-muted-foreground select-none hover:text-foreground">
                                        <span>
                                            高级选项：故障自动触发远程任务 / 编辑原始 JSON（一般无需修改）
                                        </span>
                                        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                                    </summary>
                                    <div className="space-y-3 border-t p-3.5">
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <FormField
                                                control={form.control}
                                                name="fail_trigger_tasks_raw"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-xs">
                                                            故障时自动执行的任务 ID（逗号分隔）
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                placeholder="留空即可，例如 1,2"
                                                                {...field}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="recover_trigger_tasks_raw"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-xs">
                                                            恢复后自动执行的任务 ID（逗号分隔）
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                placeholder="留空即可，例如 1,2"
                                                                {...field}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>

                                        <div className="space-y-1">
                                            <Label className="text-xs">
                                                底层规则 JSON（与上方可视化面板双向同步）
                                            </Label>
                                            <Textarea
                                                rows={3}
                                                className="resize-y font-mono text-xs"
                                                value={rulesRaw}
                                                onChange={(e) => {
                                                    form.setValue("rules_raw", e.target.value, {
                                                        shouldDirty: true,
                                                    })
                                                    try {
                                                        const arr = JSON.parse(e.target.value)
                                                        if (Array.isArray(arr)) {
                                                            setRulesUI(arr)
                                                            setPresetEpoch((n) => n + 1)
                                                        }
                                                    } catch {
                                                        // ignore invalid while typing
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>
                                </details>

                                <DialogFooter className="justify-end gap-2">
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
