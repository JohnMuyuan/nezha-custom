import {
    type AIOpsChatMessage,
    type AIOpsChatSession,
    type AIOpsConfigUpdatePayload,
    type AIOpsConfigView,
    type AIOpsIncident,
    type AIOpsSessionDetail,
    type AIOpsToolStep,
    LLM_PROVIDER_PRESETS,
    cancelAIOpsSession,
    clearAIOpsIncidents,
    deleteAIOpsSession,
    parseToolSteps,
    postAIOpsChat,
    testAIOpsModel,
    triggerAIOpsPatrolNow,
    updateAIOpsConfig,
} from "@/api/ai-ops"
import { swrFetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/useAuth"
import { useNotification } from "@/hooks/useNotfication"
import {
    Activity,
    Bot,
    CheckCircle2,
    ChevronDown,
    Loader2,
    MessageSquarePlus,
    Play,
    RotateCcw,
    Send,
    Settings2,
    ShieldCheck,
    Sparkles,
    Square,
    Terminal,
    Trash2,
    Zap,
} from "lucide-react"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { Navigate } from "react-router-dom"
import { toast } from "sonner"
import useSWR from "swr"

const STARTER_PROMPTS = [
    {
        badge: "📊 全群健康体检",
        title: "看看现在哪几台服务器负载、内存或硬盘最高",
        prompt: "帮我检查一下目前所有服务器的在线状态，重点看看 CPU、内存或硬盘占用最高的前 3 台小鸡，如果有偏高的上去看看是什么进程占用的。",
    },
    {
        badge: "🐳 Docker 容器盘点",
        title: "查看指定服务器上正在运行的所有容器",
        prompt: "帮我看看香港或主力服务器上都跑了哪些 Docker 容器，有没有重启异常或退出的容器？",
    },
    {
        badge: "🔄 自动安全升级容器",
        title: "探明配置后拉取最新镜像并无缝重建容器",
        prompt: "帮我检查一下 [请改成你的机器名] 上的 [请改成容器名] 容器是怎么部署的（Compose 还是 docker run），帮我拉取最新镜像安全升级并确认新容器正常启动。",
    },
    {
        badge: "🧹 磁盘空间瘦身",
        title: "排查大体积日志与悬空镜像并安全清理",
        prompt: "帮我找一下目前硬盘占用率最高的那台在线服务器，上去看看是哪里的日志或 Docker 镜像占满了，安全清理一下悬空镜像和过期系统日志并汇报释放了多少空间。",
    },
    {
        badge: "🚨 安全与入侵大体检",
        title: "核查陌生 SSH 登录、后门公钥、定时任务与异常外连",
        prompt: "帮我对主力在线服务器做一次安全入侵大排查：检查最近的 SSH 登录来源 IP、/root/.ssh/authorized_keys 是否有可疑公钥、crontab 是否有异常定时任务，以及当前是否有可疑对外网络连接。",
    },
]

function renderInlineFormatting(text: string): React.ReactNode[] {
    const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    return tokens.map((tok, i) => {
        if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
            return (
                <strong key={i} className="font-semibold text-foreground">
                    {tok.slice(2, -2)}
                </strong>
            )
        }
        if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
            return (
                <code
                    key={i}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-primary"
                >
                    {tok.slice(1, -1)}
                </code>
            )
        }
        return <React.Fragment key={i}>{tok}</React.Fragment>
    })
}

function parseTableRow(line: string): string[] {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "")
    return trimmed.split("|").map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
    const trimmed = line.trim()
    return /^\|?[\s:-]+(\|[\s:-]+)+\|?$/.test(trimmed) && trimmed.includes("-")
}

function renderProseLines(textBlock: string, blockIdx: number): React.ReactNode {
    const lines = textBlock.split("\n")
    const elements: React.ReactNode[] = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trim()

        // Detect Markdown table (header row + |---|---| separator row)
        if (
            trimmed.includes("|") &&
            i + 1 < lines.length &&
            isTableSeparator(lines[i + 1])
        ) {
            const headers = parseTableRow(trimmed)
            i += 2 // Skip header & separator
            const rows: string[][] = []
            while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim() !== "") {
                if (!isTableSeparator(lines[i])) {
                    rows.push(parseTableRow(lines[i]))
                }
                i++
            }
            elements.push(
                <div
                    key={`tbl-${blockIdx}-${i}`}
                    tabIndex={0}
                    role="region"
                    aria-label="运维结果数据表"
                    className="my-1.5 max-h-80 overflow-auto rounded-lg border focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
                >
                    <table className="w-full border-separate border-spacing-0 text-left text-[11px]">
                        <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-xs">
                            <tr>
                                {headers.map((h, hIdx) => (
                                    <th
                                        key={hIdx}
                                        scope="col"
                                        className="border-b px-2.5 py-1.5 font-semibold whitespace-nowrap text-foreground"
                                    >
                                        {renderInlineFormatting(h)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {rows.map((r, rIdx) => (
                                <tr key={rIdx} className="hover:bg-muted/20">
                                    {headers.map((_, cIdx) => (
                                        <td key={cIdx} className="px-2.5 py-1.5 align-top">
                                            {renderInlineFormatting(r[cIdx] ?? "")}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>,
            )
            continue
        }

        if (!trimmed) {
            elements.push(<div key={`sp-${blockIdx}-${i}`} className="h-1" />)
            i++
            continue
        }
        if (trimmed.startsWith("#### ") || trimmed.startsWith("### ")) {
            const hText = trimmed.replace(/^#+\s+/, "")
            elements.push(
                <h4
                    key={`h4-${blockIdx}-${i}`}
                    className="pt-1 text-xs font-bold text-foreground"
                >
                    {renderInlineFormatting(hText)}
                </h4>,
            )
            i++
            continue
        }
        if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
            const hText = trimmed.replace(/^#+\s+/, "")
            elements.push(
                <h3
                    key={`h3-${blockIdx}-${i}`}
                    className="pt-1 text-sm font-bold text-foreground"
                >
                    {renderInlineFormatting(hText)}
                </h3>,
            )
            i++
            continue
        }
        if (/^[-*•]\s+/.test(trimmed)) {
            elements.push(
                <div key={`ul-${blockIdx}-${i}`} className="flex items-start gap-1.5 pl-1">
                    <span className="mt-0.5 text-primary">•</span>
                    <span>{renderInlineFormatting(trimmed.replace(/^[-*•]\s+/, ""))}</span>
                </div>,
            )
            i++
            continue
        }
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/)
        if (numMatch) {
            elements.push(
                <div key={`ol-${blockIdx}-${i}`} className="flex items-start gap-1.5 pl-1">
                    <span className="min-w-4 font-semibold text-primary">{numMatch[1]}.</span>
                    <span>{renderInlineFormatting(numMatch[2])}</span>
                </div>,
            )
            i++
            continue
        }
        if (trimmed.startsWith("> ")) {
            elements.push(
                <blockquote
                    key={`bq-${blockIdx}-${i}`}
                    className="border-l-2 border-primary/50 pl-2.5 text-muted-foreground italic"
                >
                    {renderInlineFormatting(trimmed.slice(2))}
                </blockquote>,
            )
            i++
            continue
        }

        elements.push(<p key={`p-${blockIdx}-${i}`}>{renderInlineFormatting(line)}</p>)
        i++
    }

    return (
        <div key={blockIdx} className="space-y-1">
            {elements}
        </div>
    )
}

export function SimpleMarkdown({ content }: { content: string }) {
    if (!content) return null
    const blocks = content.split(/(```[\s\S]*?```)/g)
    return (
        <div className="space-y-2 text-xs leading-relaxed">
            {blocks.map((block, idx) => {
                if (block.startsWith("```") && block.endsWith("```")) {
                    const inner = block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "")
                    return (
                        <pre
                            key={idx}
                            className="overflow-x-auto rounded-md border bg-zinc-950 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-100"
                        >
                            <code>{inner}</code>
                        </pre>
                    )
                }
                return renderProseLines(block, idx)
            })}
        </div>
    )
}

function ToolStepsDisclosure({ steps }: { steps: AIOpsToolStep[] }) {
    if (!steps.length) return null
    return (
        <details className="group mt-2 rounded-lg border bg-muted/30">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-1.5 text-[11px] font-medium text-muted-foreground select-none hover:text-foreground">
                <span className="flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5 text-primary" />
                    Agent 免密执行轨迹（共 {steps.length} 步）
                </span>
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-2 border-t p-2.5">
                {steps.map((st, idx) => (
                    <div
                        key={idx}
                        className="rounded-md border bg-background p-2 text-[11px] shadow-2xs"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                    className={`inline-block h-2 w-2 rounded-full ${
                                        st.is_error ? "bg-destructive" : "bg-emerald-500"
                                    }`}
                                />
                                <span className="font-semibold">
                                    #{idx + 1} {st.summary || st.tool}
                                </span>
                                {st.server_name && (
                                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                        {st.server_name}
                                    </span>
                                )}
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                                {st.duration_ms} ms
                            </span>
                        </div>
                        {st.command && (
                            <pre className="mt-1.5 overflow-x-auto rounded bg-zinc-950 px-2 py-1 font-mono text-[10px] text-emerald-300">
                                $ {st.command}
                            </pre>
                        )}
                        {st.output && st.tool === "exec_on_server" && (
                            <details className="mt-1">
                                <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                                    查看终端返回输出
                                </summary>
                                <pre className="mt-1 max-h-48 overflow-auto rounded border bg-muted/50 p-2 font-mono text-[10px] whitespace-pre-wrap">
                                    {st.output}
                                </pre>
                            </details>
                        )}
                    </div>
                ))}
            </div>
        </details>
    )
}

export default function AIOpsPage() {
    const { profile, loading: authLoading } = useAuth()
    const { notifierGroup } = useNotification()
    const isAdmin = profile?.role === 0

    const [activeTab, setActiveTab] = useState<string>("chat")
    const [selectedSessionId, setSelectedSessionId] = useState<number>(0)
    const [promptInput, setPromptInput] = useState<string>("")
    const [submittingChat, setSubmittingChat] = useState<boolean>(false)
    const chatScrollRef = useRef<HTMLDivElement | null>(null)
    const prevMsgCountRef = useRef<number>(0)

    const { data: cfgData, mutate: mutateCfg } = useSWR<AIOpsConfigView>(
        isAdmin ? "/api/v1/ai-ops/config" : null,
        swrFetcher,
    )

    const { data: sessions, mutate: mutateSessions } = useSWR<AIOpsChatSession[]>(
        isAdmin ? "/api/v1/ai-ops/sessions" : null,
        swrFetcher,
    )

    const { data: sessionDetail, mutate: mutateSessionDetail } = useSWR<AIOpsSessionDetail>(
        isAdmin && selectedSessionId > 0 ? `/api/v1/ai-ops/sessions/${selectedSessionId}` : null,
        swrFetcher,
        {
            refreshInterval: (latest) => {
                const msgs = latest?.messages || []
                const hasRunning = msgs.some((m) => m.status === "running")
                return hasRunning ? 1200 : 0
            },
        },
    )

    const { data: incidents, mutate: mutateIncidents } = useSWR<AIOpsIncident[]>(
        isAdmin && activeTab === "patrol" ? "/api/v1/ai-ops/incidents" : null,
        swrFetcher,
        {
            refreshInterval: (latest) => {
                const busy = (latest || []).some(
                    (inc) => inc.status === "triaging" || inc.status === "diagnosing",
                )
                return busy ? 2500 : 15000
            },
        },
    )

    // Settings Form State
    const [formState, setFormState] = useState<AIOpsConfigUpdatePayload>({
        enabled: false,
        small_base_url: "https://api.deepseek.com/v1",
        small_api_key: "",
        small_model: "deepseek-chat",
        share_provider: true,
        large_base_url: "",
        large_api_key: "",
        large_model: "deepseek-reasoner",
        patrol_interval_min: 3,
        cpu_threshold: 88,
        mem_threshold: 90,
        disk_threshold: 88,
        cooldown_min: 60,
        auto_self_heal: false,
        notification_group_id: 0,
        telegram_enabled: false,
        telegram_bot_token: "",
        telegram_endpoint: "https://api.telegram.org",
        telegram_allowed_chat_ids: "",
        security_enabled: true,
        security_interval_min: 5,
        trusted_ssh_ips: "",
        outbound_spike_mbps: 50,
        conn_spike_threshold: 1200,
    })
    const [savingCfg, setSavingCfg] = useState(false)
    const [testingTier, setTestingTier] = useState<"small" | "large" | null>(null)
    const hydratedCfgRef = useRef(false)
    const autoSelectedSessionRef = useRef(false)

    const syncFormFromView = (view: AIOpsConfigView) => {
        setFormState({
            enabled: view.enabled,
            small_base_url: view.small_base_url || "https://api.deepseek.com/v1",
            small_api_key: view.small_api_key_masked || "",
            small_model: view.small_model || "deepseek-chat",
            share_provider: view.share_provider,
            large_base_url: view.large_base_url || "",
            large_api_key: view.large_api_key_masked || "",
            large_model: view.large_model || "deepseek-reasoner",
            patrol_interval_min: view.patrol_interval_min || 3,
            cpu_threshold: view.cpu_threshold || 88,
            mem_threshold: view.mem_threshold || 90,
            disk_threshold: view.disk_threshold || 88,
            cooldown_min: view.cooldown_min || 60,
            auto_self_heal: view.auto_self_heal,
            notification_group_id: view.notification_group_id || 0,
            telegram_enabled: view.telegram_enabled,
            telegram_bot_token: view.telegram_bot_token_masked || "",
            telegram_endpoint: view.telegram_endpoint || "https://api.telegram.org",
            telegram_allowed_chat_ids: view.telegram_allowed_chat_ids || "",
            security_enabled: view.security_enabled ?? true,
            security_interval_min: view.security_interval_min || 5,
            trusted_ssh_ips: view.trusted_ssh_ips || "",
            outbound_spike_mbps: view.outbound_spike_mbps || 50,
            conn_spike_threshold: view.conn_spike_threshold || 1200,
        })
    }

    useEffect(() => {
        if (!cfgData || hydratedCfgRef.current) return
        hydratedCfgRef.current = true
        syncFormFromView(cfgData)
    }, [cfgData])

    useEffect(() => {
        if (!autoSelectedSessionRef.current && sessions && sessions.length > 0) {
            autoSelectedSessionRef.current = true
            setSelectedSessionId(sessions[0].id)
        }
    }, [sessions])

    const messages: AIOpsChatMessage[] = useMemo(
        () => sessionDetail?.messages ?? [],
        [sessionDetail],
    )
    const isSessionRunning = useMemo(
        () => messages.some((m) => m.status === "running"),
        [messages],
    )

    useEffect(() => {
        const el = chatScrollRef.current
        if (!el) return
        const isNewMessage = messages.length !== prevMsgCountRef.current
        prevMsgCountRef.current = messages.length
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        if (isNewMessage || distanceFromBottom < 140) {
            if (typeof el.scrollTo === "function") {
                el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
            } else {
                el.scrollTop = el.scrollHeight
            }
        }
    }, [messages, isSessionRunning])

    if (authLoading) {
        return <div className="p-8 text-center text-sm text-muted-foreground">正在加载权限...</div>
    }
    if (!isAdmin) {
        return <Navigate to="/dashboard" replace />
    }

    const isModelConfigured = Boolean(cfgData?.has_small_key || cfgData?.has_large_key)

    const handleChatSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const text = promptInput.trim()
        if (!text || submittingChat || isSessionRunning) return
        setSubmittingChat(true)
        try {
            const res = await postAIOpsChat({
                session_id: selectedSessionId,
                prompt: text,
            })
            setPromptInput("")
            setSelectedSessionId(res.session_id)
            await mutateSessions()
            await mutateSessionDetail()
        } catch (err: any) {
            toast.error("发送失败", {
                description: err?.message || "请检查模型配置是否填写完整",
            })
        } finally {
            setSubmittingChat(false)
        }
    }

    // IME-safe Enter-to-submit: protects Chinese/Japanese Pinyin candidate confirmation (keyCode 229 / isComposing)
    const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                return
            }
            e.currentTarget.form?.requestSubmit()
        }
    }

    const handleCancelRunning = async () => {
        if (!selectedSessionId) return
        try {
            await cancelAIOpsSession(selectedSessionId)
            toast.success("已发送停止信号")
            await mutateSessionDetail()
        } catch (err: any) {
            toast.error(err?.message || "停止失败")
        }
    }

    const handleDeleteSession = async (id: number) => {
        try {
            await deleteAIOpsSession(id)
            if (selectedSessionId === id) {
                setSelectedSessionId(0)
            }
            await mutateSessions()
            toast.success("对话已删除")
        } catch (err: any) {
            toast.error(err?.message || "删除失败")
        }
    }

    const handleApplyProviderPreset = (presetId: string) => {
        const preset = LLM_PROVIDER_PRESETS.find((p) => p.id === presetId)
        if (!preset) return
        setFormState((prev) => ({
            ...prev,
            small_base_url: preset.baseUrl,
            small_model: preset.smallModel,
            share_provider: true,
            large_base_url: preset.baseUrl,
            large_model: preset.largeModel,
        }))
        toast.success(`已套用「${preset.label}」推荐双模型组合，只需填入 API Key 保存即可！`)
    }

    const handleTestModel = async (tier: "small" | "large") => {
        setTestingTier(tier)
        try {
            const res = await testAIOpsModel({
                tier,
                base_url:
                    tier === "small" || formState.share_provider
                        ? formState.small_base_url
                        : formState.large_base_url,
                api_key:
                    tier === "small" || formState.share_provider
                        ? formState.small_api_key
                        : formState.large_api_key,
                model: tier === "small" ? formState.small_model : formState.large_model,
                share_provider: formState.share_provider,
            })
            toast.success(
                `${tier === "small" ? "低级模型" : "高级模型"}连通正常 (${res.latency_ms} ms)`,
                {
                    description: `模型回复：${res.reply}`,
                },
            )
        } catch (err: any) {
            toast.error("连接测试失败", {
                description: err?.message || "请检查接口地址、API Key 和模型名是否正确",
            })
        } finally {
            setTestingTier(null)
        }
    }

    const handleSaveConfig = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setSavingCfg(true)
        try {
            const updated = await updateAIOpsConfig(formState)
            if (updated) {
                syncFormFromView(updated)
            }
            await mutateCfg()
            toast.success("AI 运维助手配置已保存生效！")
        } catch (err: any) {
            toast.error("保存失败", {
                description: err?.message || "请检查输入内容",
            })
        } finally {
            setSavingCfg(false)
        }
    }

    const handleTriggerPatrol = async () => {
        try {
            await triggerAIOpsPatrolNow()
            toast.success("已启动全群 AI 巡检，稍等几秒即可在下方看到巡检简报！")
            await mutateIncidents()
        } catch (err: any) {
            toast.error("启动巡检失败", {
                description: err?.message,
            })
        }
    }

    const handleResumeInterruptedTurn = async () => {
        if (submittingChat || isSessionRunning || !selectedSessionId) return
        setSubmittingChat(true)
        try {
            await postAIOpsChat({
                session_id: selectedSessionId,
                prompt: "请接着上一轮已完成的进度继续执行剩余操作（前面已完成的备份和镜像拉取直接复用，不要重做），完成后检查服务状态向我汇报。",
            })
            await mutateSessions()
            await mutateSessionDetail()
        } catch (err: any) {
            toast.error("继续执行失败", {
                description: err?.message || "请检查模型配置",
            })
        } finally {
            setSubmittingChat(false)
        }
    }

    const handleApplyIncidentFix = async (inc: AIOpsIncident) => {
        if (submittingChat) return
        setSubmittingChat(true)
        try {
            const fixPrompt = `请针对服务器「${inc.server_name}」(server_id=${inc.server_id}) 刚刚生成的以下只读诊断报告，直接通过 Agent 上机帮我稳妥地执行清理与修复操作（例如清理过期缓存/日志、配置 journald 容量上限等安全项；如果涉及第三方业务或探针进程是否停用，请优先清理其膨胀缓存文件而不擅自卸载用户软件），全部做完后检查 df -h / free -m 与服务状态并向我汇报结果：\n\n${inc.large_report}`
            const res = await postAIOpsChat({
                session_id: 0,
                title: `🛠️ 处置：${inc.server_name}`,
                prompt: fixPrompt,
            })
            setSelectedSessionId(res.session_id)
            setActiveTab("chat")
            await mutateSessions()
            await mutateSessionDetail()
            toast.success(`已派发给高级模型，正在上机处理「${inc.server_name}」！`)
        } catch (err: any) {
            toast.error("派发修复任务失败", {
                description: err?.message || "请检查模型配置",
            })
        } finally {
            setSubmittingChat(false)
        }
    }

    return (
        <div className="mx-auto max-w-6xl px-3 pb-10">
            {/* 顶部状态头 */}
            <div className="mt-5 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="flex items-center gap-2 text-lg font-bold">
                            <Bot className="h-5 w-5 text-primary" />
                            <span>AI 智能运维管家</span>
                        </h1>
                        <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                                cfgData?.enabled
                                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                    : "bg-muted text-muted-foreground"
                            }`}
                        >
                            {cfgData?.enabled ? "● 后台哨兵值守中" : "○ 后台自动盯盘未开启"}
                        </span>
                        {cfgData?.enabled && cfgData?.security_enabled && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                                🛡️ 入侵与防攻击护盾已开启
                            </span>
                        )}
                        {cfgData?.telegram_enabled && cfgData?.has_telegram_token && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                                ✈️ Telegram 双向遥控已连接
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        基于哪吒 Agent 加密长连接免密操控全部小鸡 · 本地 0 成本盯盘 + 低级模型初筛 + 高级模型排障与自动运维
                    </p>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
                    <TabsList className="grid w-full grid-cols-3 sm:w-auto">
                        <TabsTrigger value="chat" className="gap-1.5 text-xs">
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>AI 对话指挥</span>
                        </TabsTrigger>
                        <TabsTrigger value="patrol" className="gap-1.5 text-xs">
                            <Activity className="h-3.5 w-3.5" />
                            <span>自动盯盘报告</span>
                        </TabsTrigger>
                        <TabsTrigger value="settings" className="gap-1.5 text-xs">
                            <Settings2 className="h-3.5 w-3.5" />
                            <span>双模型与 TG 配置</span>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {!isModelConfigured && activeTab !== "settings" && (
                <div className="mb-4 flex flex-col items-start justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="text-xs leading-relaxed">
                        👋 <strong>首次启用引导</strong>：尚未填写模型 API Key！只需点右侧按钮进入设置，一键点选 DeepSeek / 硅基流动 / OpenRouter 模板并填入 API Key，就能直接指挥全部服务器干活啦。
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => setActiveTab("settings")}
                        className="shrink-0 gap-1.5"
                    >
                        <Settings2 className="h-3.5 w-3.5" />
                        去填写 API Key
                    </Button>
                </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                {/* ==================== TAB 1: AI 对话指挥中心 ==================== */}
                <TabsContent value="chat" className="mt-0">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                        {/* 左侧历史会话栏 */}
                        <div className="flex flex-col rounded-xl border bg-card p-3 lg:col-span-3 lg:h-[640px]">
                            <Button
                                type="button"
                                size="sm"
                                className="mb-3 w-full gap-1.5"
                                onClick={() => setSelectedSessionId(0)}
                            >
                                <MessageSquarePlus className="h-4 w-4" />
                                新建运维任务对话
                            </Button>

                            <div className="flex-1 space-y-1 overflow-y-auto pr-1">
                                {!sessions || sessions.length === 0 ? (
                                    <p className="py-8 text-center text-xs text-muted-foreground">
                                        暂无历史任务记录
                                    </p>
                                ) : (
                                    sessions.map((sess) => {
                                        const active = sess.id === selectedSessionId
                                        const isTG = sess.source?.startsWith("telegram:")
                                        return (
                                            <div
                                                key={sess.id}
                                                className={`group flex items-center justify-between gap-1 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                                                    active
                                                        ? "border-primary/50 bg-primary/10 font-medium"
                                                        : "border-transparent hover:bg-muted/60"
                                                }`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedSessionId(sess.id)}
                                                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                                >
                                                    <span className="shrink-0 text-[11px]">
                                                        {isTG ? "✈️" : "💬"}
                                                    </span>
                                                    <span className="truncate">{sess.title}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    aria-label="删除对话"
                                                    onClick={() => handleDeleteSession(sess.id)}
                                                    className="rounded p-1 text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            </div>
                                        )
                                    })
                                )}
                            </div>

                            <div className="mt-3 rounded-lg border bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                                <div className="flex items-center gap-1 font-semibold text-foreground">
                                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                                    <span>免密钥安全护栏已启用</span>
                                </div>
                                底层通过 Agent 通道直接执行，已硬性禁止操作{" "}
                                <code>nezha-agent</code> 自身进程及删根/断网/关机等危险指令。
                            </div>
                        </div>

                        {/* 右侧主聊天面板 */}
                        <div className="flex h-[640px] flex-col rounded-xl border bg-card lg:col-span-9">
                            <div
                                ref={chatScrollRef}
                                className="flex-1 space-y-4 overflow-y-auto p-4"
                            >
                                {selectedSessionId === 0 || messages.length === 0 ? (
                                    <div className="flex h-full flex-col items-center justify-center py-6">
                                        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                            <Bot className="h-6 w-6" />
                                        </div>
                                        <h2 className="text-base font-bold">
                                            想让 AI 帮你处理哪台服务器？
                                        </h2>
                                        <p className="mt-1 max-w-md text-center text-xs text-muted-foreground">
                                            直接用大白话吩咐即可——无论是查负载、看日志、清理磁盘还是升级某个 Docker 容器，高级模型都会通过探针通道自己一口气干完向你汇报！
                                        </p>

                                        <div className="mt-5 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                                            {STARTER_PROMPTS.map((sp, idx) => (
                                                <button
                                                    key={idx}
                                                    type="button"
                                                    onClick={() => setPromptInput(sp.prompt)}
                                                    className="flex flex-col items-start gap-1 rounded-xl border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                                                >
                                                    <span className="text-xs font-semibold text-primary">
                                                        {sp.badge}
                                                    </span>
                                                    <span className="text-xs font-medium">
                                                        {sp.title}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    messages.map((msg) => {
                                        const isUser = msg.role === "user"
                                        const steps = parseToolSteps(msg.tool_steps_json)
                                        return (
                                            <div
                                                key={msg.id}
                                                className={`flex ${
                                                    isUser ? "justify-end" : "justify-start"
                                                }`}
                                            >
                                                <div
                                                    className={`max-w-[90%] rounded-2xl px-4 py-3 ${
                                                        isUser
                                                            ? "bg-primary text-primary-foreground"
                                                            : "border bg-background"
                                                    }`}
                                                >
                                                    {!isUser && (
                                                        <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                                                            <span className="font-semibold text-foreground">
                                                                🤖 AI 运维专家
                                                            </span>
                                                            {msg.model_used && (
                                                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                                                                    {msg.model_used}
                                                                </span>
                                                            )}
                                                            {msg.status === "running" && (
                                                                <span className="inline-flex items-center gap-1 text-primary">
                                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                                    执行中
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}

                                                    {isUser ? (
                                                        <p className="text-xs whitespace-pre-wrap leading-relaxed">
                                                            {msg.content}
                                                        </p>
                                                    ) : (
                                                        <>
                                                            <SimpleMarkdown content={msg.content} />
                                                            {(msg.status === "error" ||
                                                                msg.status === "cancelled") &&
                                                                !isSessionRunning && (
                                                                    <div className="mt-2.5 flex items-center gap-2">
                                                                        <Button
                                                                            type="button"
                                                                            size="sm"
                                                                            disabled={submittingChat}
                                                                            onClick={
                                                                                handleResumeInterruptedTurn
                                                                            }
                                                                            className="h-7 gap-1.5 text-xs"
                                                                        >
                                                                            <RotateCcw className="h-3.5 w-3.5" />
                                                                            接着刚才的进度继续完成
                                                                        </Button>
                                                                    </div>
                                                                )}
                                                            <ToolStepsDisclosure steps={steps} />
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>

                            {/* 底部输入框 */}
                            <form
                                onSubmit={handleChatSubmit}
                                className="border-t bg-muted/15 p-3"
                            >
                                {isSessionRunning && (
                                    <div className="mb-2 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs">
                                        <span className="flex items-center gap-2 font-medium text-primary">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            高级模型正在连接服务器执行操作，请稍候...
                                        </span>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={handleCancelRunning}
                                            className="h-7 gap-1 text-xs"
                                        >
                                            <Square className="h-3 w-3" />
                                            停止任务
                                        </Button>
                                    </div>
                                )}

                                <div className="flex items-end gap-2">
                                    <Label htmlFor="ai-ops-chat-input" className="sr-only">
                                        输入运维指令
                                    </Label>
                                    <Textarea
                                        id="ai-ops-chat-input"
                                        name="prompt"
                                        rows={2}
                                        value={promptInput}
                                        onChange={(e) => setPromptInput(e.target.value)}
                                        onKeyDown={handleTextareaKeyDown}
                                        placeholder="直接输入你想让 AI 做的事，例如：帮我看看哪台机器内存占用最高，或者帮我升级香港小鸡的 caddy 容器...（Enter 发送，Shift+Enter 换行）"
                                        className="min-h-[56px] flex-1 resize-y text-xs"
                                    />
                                    <Button
                                        type="submit"
                                        disabled={
                                            submittingChat ||
                                            isSessionRunning ||
                                            !promptInput.trim()
                                        }
                                        className="h-[56px] shrink-0 gap-1.5 px-4"
                                    >
                                        <Send className="h-4 w-4" />
                                        发送指令
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </div>
                </TabsContent>

                {/* ==================== TAB 2: 自动盯盘与巡检报告 ==================== */}
                <TabsContent value="patrol" className="mt-0 space-y-4">
                    <div className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
                        <div className="space-y-1">
                            <h2 className="text-sm font-bold">
                                三级智能盯盘漏斗：0 成本哨兵 → 低级模型初筛 → 高级模型上机排障
                            </h2>
                            <p className="text-xs text-muted-foreground">
                                平时风平浪静时由本地 Go 引擎每秒比对，1 分钱 Token 都不花；一旦发现指标持续超标，先由低级模型秒判是否为正常波动，确属异常才唤醒高级模型通过 Agent 深查根因并推送给你。
                            </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                            <Button
                                type="button"
                                size="sm"
                                onClick={handleTriggerPatrol}
                                className="gap-1.5"
                            >
                                <Play className="h-3.5 w-3.5" />
                                立即巡检全群
                            </Button>
                            {incidents && incidents.length > 0 && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                        await clearAIOpsIncidents()
                                        await mutateIncidents()
                                        toast.success("已清空历史巡检记录")
                                    }}
                                    className="gap-1.5"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    清空记录
                                </Button>
                            )}
                        </div>
                    </div>

                    {!incidents || incidents.length === 0 ? (
                        <div className="rounded-xl border bg-card py-16 text-center text-xs text-muted-foreground">
                            目前还没有任何异常报告（说明你的小鸡群运行平稳，或可点击右上角「立即巡检全群」马上生成一份全群健康体检简报！）
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {incidents.map((inc) => {
                                const steps = parseToolSteps(inc.tool_steps_json)
                                const isSecurityEvent = inc.trigger_type?.startsWith("security_")
                                const isHighRiskSecurity =
                                    inc.trigger_type === "security_ssh" ||
                                    inc.trigger_type === "security_tamper"
                                const statusBadge = (() => {
                                    switch (inc.status) {
                                        case "dismissed_by_small":
                                            return (
                                                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                                                    🟢 低级模型判定正常波动（已省流拦截）
                                                </span>
                                            )
                                        case "triaging":
                                        case "diagnosing":
                                            return (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                    正在自动上机取证排查中...
                                                </span>
                                            )
                                        case "error":
                                            return (
                                                <span className="rounded-full bg-destructive/15 px-2.5 py-0.5 text-[11px] font-medium text-destructive">
                                                    ⚠️ 模型调用出错
                                                </span>
                                            )
                                        case "healed":
                                            return (
                                                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                                                    🛠️ 已出诊断并自动处置
                                                </span>
                                            )
                                        default:
                                            if (isHighRiskSecurity) {
                                                return (
                                                    <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                                                        🚨 高危安全入侵/篡改取证（待你确认处置）
                                                    </span>
                                                )
                                            }
                                            if (isSecurityEvent) {
                                                return (
                                                    <span className="rounded-full bg-orange-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700 dark:text-orange-300">
                                                        🛡️ 流量外泄 / 攻击预警（待你确认处置）
                                                    </span>
                                                )
                                            }
                                            return (
                                                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                                    {inc.server_id > 0
                                                        ? "📋 只读诊断完成（尚未修改服务器）"
                                                        : "📋 全群健康巡检简报"}
                                                </span>
                                            )
                                    }
                                })()

                                return (
                                    <div
                                        key={inc.id}
                                        className={`space-y-2.5 rounded-xl border bg-card p-4 shadow-2xs ${
                                            isHighRiskSecurity
                                                ? "border-rose-500/50"
                                                : isSecurityEvent
                                                  ? "border-orange-500/40"
                                                  : ""
                                        }`}
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-bold">
                                                    {inc.server_name}
                                                </span>
                                                {statusBadge}
                                                <span className="text-xs text-muted-foreground">
                                                    触发原因：{inc.trigger_summary}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {inc.server_id > 0 &&
                                                    inc.status === "reported" &&
                                                    Boolean(inc.large_report) && (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            disabled={submittingChat}
                                                            onClick={() =>
                                                                handleApplyIncidentFix(inc)
                                                            }
                                                            className="h-7 gap-1.5 text-xs"
                                                        >
                                                            <Sparkles className="h-3.5 w-3.5" />
                                                            一键让 AI 按此建议去处理
                                                        </Button>
                                                    )}
                                                <span className="text-[11px] text-muted-foreground">
                                                    {new Date(inc.created_at).toLocaleString()}
                                                </span>
                                            </div>
                                        </div>

                                        {inc.small_verdict && (
                                            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                                                <strong>👮 低级模型初筛结论：</strong>{" "}
                                                {inc.small_verdict}
                                            </div>
                                        )}

                                        {inc.large_report && (
                                            <div className="rounded-lg border bg-background p-3">
                                                <SimpleMarkdown content={inc.large_report} />
                                            </div>
                                        )}

                                        <ToolStepsDisclosure steps={steps} />
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </TabsContent>

                {/* ==================== TAB 3: 双模型与 Telegram 配置 ==================== */}
                <TabsContent value="settings" className="mt-0">
                    <form onSubmit={handleSaveConfig} className="space-y-5">
                        {/* 1. 一键服务商预设 */}
                        <fieldset className="space-y-2.5 rounded-xl border bg-card p-4">
                            <legend className="px-1.5 text-sm font-bold">
                                1. 一键选择 AI 平台预设（兼容所有 OpenAI 格式接口）
                            </legend>
                            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                                {LLM_PROVIDER_PRESETS.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => handleApplyProviderPreset(p.id)}
                                        className="flex flex-col items-start gap-1 rounded-lg border bg-background p-2.5 text-left transition-colors hover:border-primary hover:bg-primary/5"
                                    >
                                        <div className="flex w-full items-center justify-between gap-1">
                                            <span className="truncate text-xs font-semibold">
                                                {p.label.split(" ")[0]}
                                            </span>
                                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                                {p.badge}
                                            </span>
                                        </div>
                                        <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                                            {p.hint}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </fieldset>

                        {/* 2. 低级模型 + 高级模型设置 */}
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {/* 低级模型 */}
                            <fieldset className="space-y-3 rounded-xl border bg-card p-4">
                                <legend className="px-1.5 text-sm font-bold">
                                    👮 低级模型（值班班长：24 小时异常初筛）
                                </legend>
                                <p className="text-xs text-muted-foreground">
                                    建议选响应快、价格极低甚至免费的轻量模型（如{" "}
                                    <code>deepseek-chat</code>、<code>Qwen2.5-7B</code>、
                                    <code>gemini-2.5-flash-lite</code>）。
                                </p>

                                <div className="space-y-1">
                                    <Label htmlFor="small_base_url" className="text-xs">
                                        API 接口地址 (Base URL)
                                    </Label>
                                    <Input
                                        id="small_base_url"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        value={formState.small_base_url}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                small_base_url: e.target.value,
                                            })
                                        }
                                        placeholder="https://api.deepseek.com/v1"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <Label htmlFor="small_api_key" className="text-xs">
                                        API Key 密钥{" "}
                                        {cfgData?.has_small_key && (
                                            <span className="text-emerald-600 dark:text-emerald-400">
                                                （已安全加密保存，不改无需重填）
                                            </span>
                                        )}
                                    </Label>
                                    <Input
                                        id="small_api_key"
                                        type="password"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        value={formState.small_api_key}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                small_api_key: e.target.value,
                                            })
                                        }
                                        placeholder="sk-..."
                                    />
                                </div>

                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="small_model" className="text-xs">
                                            低级模型名称 (Model ID)
                                        </Label>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={testingTier !== null}
                                            onClick={() => handleTestModel("small")}
                                            className="h-6 gap-1 px-2 text-[11px]"
                                        >
                                            {testingTier === "small" ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <Zap className="h-3 w-3 text-amber-500" />
                                            )}
                                            测试低级模型
                                        </Button>
                                    </div>
                                    <Input
                                        id="small_model"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        value={formState.small_model}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                small_model: e.target.value,
                                            })
                                        }
                                        placeholder="deepseek-chat"
                                    />
                                </div>
                            </fieldset>

                            {/* 高级模型 */}
                            <fieldset className="space-y-3 rounded-xl border bg-card p-4">
                                <legend className="px-1.5 text-sm font-bold">
                                    🧠 高级模型（主治医生：深度排障与自动运维）
                                </legend>
                                <p className="text-xs text-muted-foreground">
                                    负责接收初筛上报并上机深度排障，以及在你下令时全自动升级容器、清理空间（推荐{" "}
                                    <code>deepseek-reasoner</code>、<code>claude-sonnet-4</code>、
                                    <code>gemini-2.5-pro</code>）。
                                </p>

                                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                                    <Checkbox
                                        id="share_provider_chk"
                                        checked={formState.share_provider}
                                        onCheckedChange={(v) =>
                                            setFormState({
                                                ...formState,
                                                share_provider: Boolean(v),
                                            })
                                        }
                                    />
                                    <Label
                                        htmlFor="share_provider_chk"
                                        className="cursor-pointer text-xs font-medium"
                                    >
                                        与低级模型共用同一个接口地址和 API Key（省事推荐！）
                                    </Label>
                                </div>

                                {!formState.share_provider && (
                                    <>
                                        <div className="space-y-1">
                                            <Label htmlFor="large_base_url" className="text-xs">
                                                高级模型 API 接口地址 (Base URL)
                                            </Label>
                                            <Input
                                                id="large_base_url"
                                                autoCorrect="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                value={formState.large_base_url}
                                                onChange={(e) =>
                                                    setFormState({
                                                        ...formState,
                                                        large_base_url: e.target.value,
                                                    })
                                                }
                                                placeholder="https://openrouter.ai/api/v1"
                                            />
                                        </div>

                                        <div className="space-y-1">
                                            <Label htmlFor="large_api_key" className="text-xs">
                                                高级模型 API Key{" "}
                                                {cfgData?.has_large_key && (
                                                    <span className="text-emerald-600 dark:text-emerald-400">
                                                        （已保存）
                                                    </span>
                                                )}
                                            </Label>
                                            <Input
                                                id="large_api_key"
                                                type="password"
                                                autoCorrect="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                value={formState.large_api_key}
                                                onChange={(e) =>
                                                    setFormState({
                                                        ...formState,
                                                        large_api_key: e.target.value,
                                                    })
                                                }
                                                placeholder="sk-..."
                                            />
                                        </div>
                                    </>
                                )}

                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="large_model" className="text-xs">
                                            高级模型名称 (Model ID)
                                        </Label>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={testingTier !== null}
                                            onClick={() => handleTestModel("large")}
                                            className="h-6 gap-1 px-2 text-[11px]"
                                        >
                                            {testingTier === "large" ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <Zap className="h-3 w-3 text-primary" />
                                            )}
                                            测试高级模型
                                        </Button>
                                    </div>
                                    <Input
                                        id="large_model"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        value={formState.large_model}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                large_model: e.target.value,
                                            })
                                        }
                                        placeholder="deepseek-reasoner"
                                    />
                                </div>
                            </fieldset>
                        </div>

                        {/* 3. 自动哨兵盯盘与推送设置 */}
                        <fieldset className="space-y-3.5 rounded-xl border bg-card p-4">
                            <legend className="px-1.5 text-sm font-bold">
                                🛡️ 后台自动盯盘哨兵与通知推送
                            </legend>

                            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5">
                                <Checkbox
                                    id="ai_sentinel_enable"
                                    checked={formState.enabled}
                                    onCheckedChange={(v) =>
                                        setFormState({ ...formState, enabled: Boolean(v) })
                                    }
                                />
                                <Label
                                    htmlFor="ai_sentinel_enable"
                                    className="cursor-pointer text-xs font-semibold"
                                >
                                    ✅ 开启 24 小时自动盯盘（平时本地 Go 监控 0 Token 消耗，发现异常自动交给高低双模型排查汇报）
                                </Label>
                            </div>

                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                                <div className="space-y-1">
                                    <Label htmlFor="patrol_interval_min" className="text-xs">
                                        哨兵扫描间隔 (分钟)
                                    </Label>
                                    <Input
                                        id="patrol_interval_min"
                                        type="number"
                                        min={1}
                                        max={1440}
                                        value={formState.patrol_interval_min}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                patrol_interval_min: Number(e.target.value) || 3,
                                            })
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="cpu_threshold" className="text-xs">
                                        CPU 触发线 (%)
                                    </Label>
                                    <Input
                                        id="cpu_threshold"
                                        type="number"
                                        min={30}
                                        max={100}
                                        value={formState.cpu_threshold}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                cpu_threshold: Number(e.target.value) || 88,
                                            })
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="mem_threshold" className="text-xs">
                                        内存触发线 (%)
                                    </Label>
                                    <Input
                                        id="mem_threshold"
                                        type="number"
                                        min={30}
                                        max={100}
                                        value={formState.mem_threshold}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                mem_threshold: Number(e.target.value) || 90,
                                            })
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="disk_threshold" className="text-xs">
                                        硬盘触发线 (%)
                                    </Label>
                                    <Input
                                        id="disk_threshold"
                                        type="number"
                                        min={30}
                                        max={100}
                                        value={formState.disk_threshold}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                disk_threshold: Number(e.target.value) || 88,
                                            })
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="cooldown_min" className="text-xs">
                                        同机冷却时间 (分钟)
                                    </Label>
                                    <Input
                                        id="cooldown_min"
                                        type="number"
                                        min={5}
                                        max={1440}
                                        value={formState.cooldown_min}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                cooldown_min: Number(e.target.value) || 60,
                                            })
                                        }
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">
                                        诊断报告同步推送到通知分组（Bark / 企微 / 飞书等）
                                    </Label>
                                    <Select
                                        value={String(formState.notification_group_id || 0)}
                                        onValueChange={(v) =>
                                            setFormState({
                                                ...formState,
                                                notification_group_id: Number(v),
                                            })
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="0">
                                                不额外推通知组（仅在面板保存 / 推下方 TG 机器人）
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
                                </div>

                                <div className="flex items-end">
                                    <div className="flex w-full items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2.5">
                                        <Checkbox
                                            id="auto_self_heal_chk"
                                            checked={formState.auto_self_heal}
                                            onCheckedChange={(v) =>
                                                setFormState({
                                                    ...formState,
                                                    auto_self_heal: Boolean(v),
                                                })
                                            }
                                        />
                                        <Label
                                            htmlFor="auto_self_heal_chk"
                                            className="cursor-pointer text-xs leading-snug"
                                        >
                                            后台无人巡检时也允许自动修复（不勾选则后台巡检仅只读查因；你主动对话时始终支持全自动干活）
                                        </Label>
                                    </div>
                                </div>
                            </div>
                        </fieldset>

                        {/* 3.5 AI 安全入侵与防攻击哨兵 */}
                        <fieldset className="space-y-3.5 rounded-xl border border-rose-500/25 bg-card p-4">
                            <legend className="px-1.5 text-sm font-bold text-rose-600 dark:text-rose-400">
                                🚨 AI 安全入侵与防攻击护盾（防陌生 SSH 登录 / 后门篡改 / 拖库外泄 / 网站被攻击）
                            </legend>

                            <div className="flex items-center gap-2.5 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3.5 py-2.5">
                                <Checkbox
                                    id="ai_security_enable"
                                    checked={formState.security_enabled}
                                    onCheckedChange={(v) =>
                                        setFormState({
                                            ...formState,
                                            security_enabled: Boolean(v),
                                        })
                                    }
                                />
                                <Label
                                    htmlFor="ai_security_enable"
                                    className="cursor-pointer text-xs font-semibold leading-snug"
                                >
                                    🛡️ 启用全天候安全入侵与防攻击哨兵（静默核对 SSH 登录与公钥/账号/定时任务指纹 + 监控出站流量与连接暴涨，平时 0 Token 消耗！）
                                </Label>
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                                <div className="space-y-1 sm:col-span-6">
                                    <div className="flex flex-wrap items-center justify-between gap-1">
                                        <Label htmlFor="trusted_ssh_ips" className="text-xs">
                                            信任的管理员 SSH 登录 IP 白名单（逗号分隔，支持网段如 1.2.3.0/24）
                                        </Label>
                                        {profile?.login_ip && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const curIp = profile.login_ip!.trim()
                                                    const existing = formState.trusted_ssh_ips
                                                        .split(/[,，\s]+/)
                                                        .map((s) => s.trim())
                                                        .filter(Boolean)
                                                    if (!existing.includes(curIp)) {
                                                        setFormState({
                                                            ...formState,
                                                            trusted_ssh_ips: [...existing, curIp].join(", "),
                                                        })
                                                    }
                                                }}
                                                className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20"
                                            >
                                                + 填入我当前 IP ({profile.login_ip})
                                            </button>
                                        )}
                                    </div>
                                    <Input
                                        id="trusted_ssh_ips"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        value={formState.trusted_ssh_ips}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                trusted_ssh_ips: e.target.value,
                                            })
                                        }
                                        placeholder="例如：23.147.56.205（白名单外的陌生 IP 登录任意小鸡 SSH 将立即触发最高级警报！）"
                                    />
                                </div>

                                <div className="space-y-1 sm:col-span-2">
                                    <Label htmlFor="security_interval_min" className="text-xs">
                                        后门巡检间隔 (分)
                                    </Label>
                                    <Input
                                        id="security_interval_min"
                                        type="number"
                                        min={2}
                                        max={1440}
                                        value={formState.security_interval_min}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                security_interval_min: Number(e.target.value) || 5,
                                            })
                                        }
                                    />
                                </div>

                                <div className="space-y-1 sm:col-span-2">
                                    <Label htmlFor="outbound_spike_mbps" className="text-xs">
                                        外泄上传线 (Mbps)
                                    </Label>
                                    <Input
                                        id="outbound_spike_mbps"
                                        type="number"
                                        min={5}
                                        max={100000}
                                        value={formState.outbound_spike_mbps}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                outbound_spike_mbps: Number(e.target.value) || 50,
                                            })
                                        }
                                    />
                                </div>

                                <div className="space-y-1 sm:col-span-2">
                                    <Label htmlFor="conn_spike_threshold" className="text-xs">
                                        被攻击连接数线
                                    </Label>
                                    <Input
                                        id="conn_spike_threshold"
                                        type="number"
                                        min={100}
                                        max={1000000}
                                        value={formState.conn_spike_threshold}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                conn_spike_threshold:
                                                    Number(e.target.value) || 1200,
                                            })
                                        }
                                    />
                                </div>
                            </div>
                        </fieldset>

                        {/* 4. Telegram 双向遥控机器人 */}
                        <fieldset className="space-y-3 rounded-xl border bg-card p-4">
                            <legend className="px-1.5 text-sm font-bold">
                                ✈️ Telegram 手机随时随地对话遥控（免配置域名与 Webhook！）
                            </legend>

                            <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 text-xs leading-relaxed text-muted-foreground">
                                💡 <strong>小白三步绑定</strong>：① 在 Telegram 找{" "}
                                <code>@BotFather</code> 发送 <code>/newbot</code> 拿到{" "}
                                <strong>Bot Token</strong> 填在下方并勾选开启；② 先点保存，去 Telegram 给你的机器人发一句任意消息，机器人会自动把你的专属{" "}
                                <strong>Chat ID</strong> 回复给你；③ 把那个数字填回「允许操控的管理员 Chat ID」再保存，以后除了你任何人都碰不了你的机器，你在手机 TG 发一句话它就上去帮你升级容器、查负载！
                            </div>

                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="tg_bot_enable_chk"
                                    checked={formState.telegram_enabled}
                                    onCheckedChange={(v) =>
                                        setFormState({
                                            ...formState,
                                            telegram_enabled: Boolean(v),
                                        })
                                    }
                                />
                                <Label
                                    htmlFor="tg_bot_enable_chk"
                                    className="cursor-pointer text-xs font-semibold"
                                >
                                    启用 Telegram 双向 AI 运维机器人
                                </Label>
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div className="space-y-1">
                                    <Label htmlFor="tg_bot_token" className="text-xs">
                                        Telegram Bot Token{" "}
                                        {cfgData?.has_telegram_token && (
                                            <span className="text-emerald-600 dark:text-emerald-400">
                                                （已保存）
                                            </span>
                                        )}
                                    </Label>
                                    <Input
                                        id="tg_bot_token"
                                        type="password"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        value={formState.telegram_bot_token}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                telegram_bot_token: e.target.value,
                                            })
                                        }
                                        placeholder="123456789:AAHxyz..."
                                    />
                                </div>

                                <div className="space-y-1">
                                    <Label htmlFor="tg_allowed_ids" className="text-xs">
                                        允许操控的管理员 Chat ID（多个用逗号隔开）
                                    </Label>
                                    <Input
                                        id="tg_allowed_ids"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        value={formState.telegram_allowed_chat_ids}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                telegram_allowed_chat_ids: e.target.value,
                                            })
                                        }
                                        placeholder="例如：987654321"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <Label htmlFor="tg_endpoint" className="text-xs">
                                        Telegram API 地址（海外机保持默认）
                                    </Label>
                                    <Input
                                        id="tg_endpoint"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        value={formState.telegram_endpoint}
                                        onChange={(e) =>
                                            setFormState({
                                                ...formState,
                                                telegram_endpoint: e.target.value,
                                            })
                                        }
                                        placeholder="https://api.telegram.org"
                                    />
                                </div>
                            </div>
                        </fieldset>

                        <div className="flex justify-end">
                            <Button type="submit" disabled={savingCfg} className="gap-1.5 px-6">
                                {savingCfg ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <CheckCircle2 className="h-4 w-4" />
                                )}
                                保存全部配置
                            </Button>
                        </div>
                    </form>
                </TabsContent>
            </Tabs>
        </div>
    )
}
