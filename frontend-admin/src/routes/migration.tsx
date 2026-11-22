import {
    AgentMigrateItemResult,
    BackupConfigUpdatePayload,
    BackupConfigView,
    batchMigrateAgents,
    exportBackupArchive,
    formatBytes,
    getBackupConfig,
    restoreBackupArchive,
    triggerTelegramBackupNow,
    updateBackupConfig,
} from "@/api/backup"
import { getServers } from "@/api/server"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/useAuth"
import { ModelServer } from "@/types"
import {
    Archive,
    CheckCircle2,
    Copy,
    Download,
    Eye,
    EyeOff,
    HardDrive,
    Loader2,
    Lock,
    RefreshCw,
    Save,
    Send,
    Server,
    ShieldAlert,
    Truck,
    Upload,
    XCircle,
} from "lucide-react"
import React, { useEffect, useId, useMemo, useRef, useState } from "react"
import { Navigate } from "react-router-dom"
import { toast } from "sonner"
import useSWR from "swr"

function isServerOnline(srv: ModelServer): boolean {
    if (!srv.last_active) return false
    const ts = new Date(srv.last_active).getTime()
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < 90_000
}

function isWindowsServer(srv: ModelServer): boolean {
    return (srv.host?.platform || "").toLowerCase().includes("windows")
}

export default function MigrationPage() {
    const { profile, loading: authLoading } = useAuth()
    const isAdmin = profile?.role === 0

    const [activeTab, setActiveTab] = useState("backup")

    const { data: cfg, mutate: mutateCfg } = useSWR<BackupConfigView>(
        isAdmin ? "/api/v1/backup/config" : null,
        getBackupConfig,
        { revalidateOnFocus: false },
    )
    const { data: servers, mutate: mutateServers } = useSWR<ModelServer[]>(
        isAdmin ? "/api/v1/server" : null,
        getServers,
        { revalidateOnFocus: false },
    )

    // Backup settings form state
    const [formState, setFormState] = useState<BackupConfigUpdatePayload>({
        telegram_auto_enabled: false,
        schedule_hour: 3,
        schedule_minute: 15,
        include_tsdb: false,
        encrypt_password: "",
        use_ai_ops_telegram: true,
        telegram_bot_token: "",
        telegram_endpoint: "https://api.telegram.org",
        telegram_chat_id: "",
    })
    const hydratedRef = useRef(false)
    const [savingCfg, setSavingCfg] = useState(false)
    const [showEncryptPwd, setShowEncryptPwd] = useState(false)
    const [sendingTg, setSendingTg] = useState(false)
    const [exporting, setExporting] = useState(false)

    // Local upload & restore state
    const [restoreFile, setRestoreFile] = useState<File | null>(null)
    const [restorePwd, setRestorePwd] = useState("")
    const [showRestorePwd, setShowRestorePwd] = useState(false)
    const [restoring, setRestoring] = useState(false)
    const [restoreNotice, setRestoreNotice] = useState("")
    const restoreDialogRef = useRef<HTMLDialogElement>(null)
    const restoreTitleId = useId()

    // Batch Agent endpoint migration state (Scenario B: changing domain/port)
    const [newServerAddr, setNewServerAddr] = useState("")
    const [newUseTLS, setNewUseTLS] = useState(false)
    const [selectedServerIds, setSelectedServerIds] = useState<number[]>([])
    const [migrating, setMigrating] = useState(false)
    const [migrateResults, setMigrateResults] = useState<AgentMigrateItemResult[]>([])
    const migrateDialogRef = useRef<HTMLDialogElement>(null)
    const migrateTitleId = useId()

    const syncFromView = (v: BackupConfigView) => {
        setFormState({
            telegram_auto_enabled: v.telegram_auto_enabled,
            schedule_hour: v.schedule_hour ?? 3,
            schedule_minute: v.schedule_minute ?? 15,
            include_tsdb: Boolean(v.include_tsdb),
            encrypt_password: v.encrypt_password_masked || "",
            use_ai_ops_telegram: v.use_ai_ops_telegram ?? true,
            telegram_bot_token: v.telegram_bot_token_masked || "",
            telegram_endpoint: v.telegram_endpoint || "https://api.telegram.org",
            telegram_chat_id: v.telegram_chat_id || "",
        })
    }

    useEffect(() => {
        if (!cfg || hydratedRef.current) return
        hydratedRef.current = true
        syncFromView(cfg)
    }, [cfg])

    const onlineLinuxServers = useMemo(
        () => (servers ?? []).filter((s) => isServerOnline(s) && !isWindowsServer(s)),
        [servers],
    )

    if (authLoading) {
        return <div className="p-8 text-center text-sm text-muted-foreground">正在加载权限...</div>
    }
    if (!isAdmin) {
        return <Navigate to="/dashboard" replace />
    }

    const coreSizeBytes = (cfg?.db_size_bytes || 0) + (cfg?.config_size_bytes || 0)
    const installHostDisplay = cfg?.install_host || `你的域名:${cfg?.listen_port || 8008}`
    const listenPort = cfg?.listen_port || 8008
    const hasEncryption = Boolean(
        cfg?.has_encrypt_password ||
            (formState.encrypt_password.trim() !== "" &&
                formState.encrypt_password !== "__CLEAR__"),
    )

    const copyCommand = async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text)
            toast.success(`已复制「${label}」`)
        } catch {
            toast.error("复制失败，请手动选中复制")
        }
    }

    const handleSaveConfig = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setSavingCfg(true)
        try {
            const updated = await updateBackupConfig(formState)
            if (updated) {
                syncFromView(updated)
            }
            await mutateCfg()
            toast.success("备份与自动推送设置已保存！")
        } catch (err: any) {
            toast.error("保存失败", { description: err?.message })
        } finally {
            setSavingCfg(false)
        }
    }

    const handleSendTelegramNow = async () => {
        setSendingTg(true)
        try {
            const updated = await triggerTelegramBackupNow()
            if (updated) {
                syncFromView(updated)
            }
            await mutateCfg()
            toast.success("已将最新热备份包发送到你的 Telegram 机器人私聊！")
        } catch (err: any) {
            toast.error("Telegram 备份发送失败", { description: err?.message })
            await mutateCfg()
        } finally {
            setSendingTg(false)
        }
    }

    const handleExportLocal = async () => {
        setExporting(true)
        try {
            const res = await exportBackupArchive({
                include_tsdb: formState.include_tsdb,
                encrypt_password:
                    formState.encrypt_password && !formState.encrypt_password.includes("••••")
                        ? formState.encrypt_password
                        : "",
                use_saved_password:
                    formState.encrypt_password !== "__CLEAR__" && Boolean(cfg?.has_encrypt_password),
            })
            toast.success(`已下载备份包：${res.filename}（${formatBytes(res.size)}）`)
        } catch (err: any) {
            toast.error("导出备份失败", { description: err?.message })
        } finally {
            setExporting(false)
        }
    }

    const executeRestore = async () => {
        if (!restoreFile || restoring) return
        setRestoring(true)
        setRestoreNotice("")
        try {
            const res = await restoreBackupArchive(restoreFile, restorePwd)
            setRestoreNotice(res.message)
            toast.success("数据已还原，面板正在自动重启生效（约 5 秒后刷新即可）！")
        } catch (err: any) {
            toast.error("还原失败", { description: err?.message })
        } finally {
            setRestoring(false)
        }
    }

    const handleRestoreDialogClose = () => {
        const dlg = restoreDialogRef.current
        if (!dlg) return
        const choice = dlg.returnValue
        dlg.returnValue = ""
        if (choice === "confirm") {
            void executeRestore()
        }
    }

    const executeBatchMigrate = async () => {
        if (migrating || selectedServerIds.length === 0 || !newServerAddr.trim()) return
        setMigrating(true)
        setMigrateResults([])
        try {
            const res = await batchMigrateAgents({
                server_ids: selectedServerIds,
                new_server: newServerAddr.trim(),
                use_tls: newUseTLS,
            })
            const list = res?.results ?? []
            setMigrateResults(list)
            const okCount = list.filter((r) => r.success).length
            toast.success(`批量迁移指令执行完毕：成功 ${okCount} / ${list.length} 台`)
            await mutateServers()
        } catch (err: any) {
            toast.error("批量迁移失败", { description: err?.message })
        } finally {
            setMigrating(false)
        }
    }

    const handleMigrateDialogClose = () => {
        const dlg = migrateDialogRef.current
        if (!dlg) return
        const choice = dlg.returnValue
        dlg.returnValue = ""
        if (choice === "confirm") {
            void executeBatchMigrate()
        }
    }

    const toggleServerSelection = (id: number) => {
        setSelectedServerIds((prev) =>
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
        )
    }

    const oldVpsSaveImageCmd = `docker save nezha-custom:latest | gzip > nezha-image.tar.gz`
    const newVpsRestoreCmd = hasEncryption
        ? `openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -in nezha-backup-*.tar.gz.enc -out nezha-backup.tar.gz\nmkdir -p /tmp/nezha-restore && tar -xzf nezha-backup.tar.gz -C /tmp/nezha-restore\n[ -f nezha-image.tar.gz ] && cp nezha-image.tar.gz /tmp/nezha-restore/\nbash /tmp/nezha-restore/restore.sh`
        : `mkdir -p /tmp/nezha-restore && tar -xzf nezha-backup-*.tar.gz -C /tmp/nezha-restore\n[ -f nezha-image.tar.gz ] && cp nezha-image.tar.gz /tmp/nezha-restore/\nbash /tmp/nezha-restore/restore.sh`

    return (
        <div className="mx-auto max-w-6xl px-3 pb-12">
            {/* 顶部标题与资产概览 */}
            <div className="mt-5 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="flex items-center gap-2 text-lg font-bold">
                            <Archive className="h-5 w-5 text-primary" />
                            <span>数据备份与一键搬家</span>
                        </h1>
                        <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                                cfg?.telegram_auto_enabled
                                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                    : "bg-muted text-muted-foreground"
                            }`}
                        >
                            {cfg?.telegram_auto_enabled
                                ? `● 每日 ${String(cfg.schedule_hour).padStart(2, "0")}:${String(cfg.schedule_minute).padStart(2, "0")} 自动发 TG`
                                : "○ 每日 TG 自动备份未开启"}
                        </span>
                        {cfg?.has_encrypt_password && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                                🔐 AES-256 加密已开启
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        SQLite 在线热备份（不断服、不损库） · Telegram 免费异地留档 · 换机 DNS 一改全部小鸡 10 秒自动归队
                    </p>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
                    <TabsList className="grid w-full grid-cols-3 sm:w-auto">
                        <TabsTrigger value="backup" className="gap-1.5 text-xs">
                            <HardDrive className="h-3.5 w-3.5" />
                            <span>备份与还原</span>
                        </TabsTrigger>
                        <TabsTrigger value="guide" className="gap-1.5 text-xs">
                            <Truck className="h-3.5 w-3.5" />
                            <span>新机一键搬家</span>
                        </TabsTrigger>
                        <TabsTrigger value="agents" className="gap-1.5 text-xs">
                            <Server className="h-3.5 w-3.5" />
                            <span>批量改小鸡地址</span>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* 关键状态卡片 */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border bg-card p-3">
                    <div className="text-[11px] text-muted-foreground">核心数据体积（压缩后 &lt; 1MB）</div>
                    <div className="mt-1 text-base font-bold">{formatBytes(coreSizeBytes)}</div>
                    <div className="text-[10px] text-muted-foreground">
                        DB {formatBytes(cfg?.db_size_bytes)} · TSDB {formatBytes(cfg?.tsdb_size_bytes)}
                    </div>
                </div>
                <div className="rounded-xl border bg-card p-3">
                    <div className="text-[11px] text-muted-foreground">纳管小鸡（在线 / 总数）</div>
                    <div className="mt-1 text-base font-bold">
                        {cfg?.online_servers ?? 0} / {cfg?.total_servers ?? 0} 台
                    </div>
                    <div className="text-[10px] text-muted-foreground">换同域名新机全部免重装</div>
                </div>
                <div className="rounded-xl border bg-card p-3">
                    <div className="text-[11px] text-muted-foreground">当前 Agent 接入域名</div>
                    <div className="mt-1 truncate font-mono text-xs font-bold">
                        {installHostDisplay}
                    </div>
                    <div className="text-[10px] text-muted-foreground">监听端口：{listenPort}</div>
                </div>
                <div className="rounded-xl border bg-card p-3">
                    <div className="text-[11px] text-muted-foreground">最近一次 TG 备份状态</div>
                    <div className="mt-1 truncate text-xs font-bold">
                        {cfg?.last_backup_status === "ok"
                            ? "✅ 推送成功"
                            : cfg?.last_backup_status === "error"
                              ? "⚠️ 推送失败"
                              : "尚未执行过"}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                        {cfg?.last_backup_at
                            ? new Date(cfg.last_backup_at).toLocaleString()
                            : "点击下方按钮可立即测试一次"}
                    </div>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                {/* ==================== TAB 1: 数据备份与还原 ==================== */}
                <TabsContent value="backup" className="mt-0 space-y-4">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                        {/* 左：Telegram 每日自动定时备份配置 */}
                        <form
                            onSubmit={handleSaveConfig}
                            className="space-y-4 rounded-xl border bg-card p-4 lg:col-span-7"
                        >
                            <fieldset className="space-y-3.5">
                                <legend className="text-sm font-bold">
                                    ✈️ 每天定时自动发到 Telegram 机器人私聊（0 成本异地容灾）
                                </legend>

                                <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-2.5">
                                    <Checkbox
                                        id="tg_auto_backup_chk"
                                        checked={formState.telegram_auto_enabled}
                                        onCheckedChange={(v) =>
                                            setFormState({
                                                ...formState,
                                                telegram_auto_enabled: Boolean(v),
                                            })
                                        }
                                    />
                                    <Label
                                        htmlFor="tg_auto_backup_chk"
                                        className="cursor-pointer text-xs font-semibold leading-snug"
                                    >
                                        开启每日定时自动备份并发送到 Telegram 私聊（打包 config.yaml + SQLite 热快照 + docker-compose + 一键恢复脚本）
                                    </Label>
                                </div>

                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="backup_hour" className="text-xs">
                                            每日执行小时 (0-23)
                                        </Label>
                                        <Input
                                            id="backup_hour"
                                            name="schedule_hour"
                                            type="number"
                                            min={0}
                                            max={23}
                                            value={formState.schedule_hour}
                                            onChange={(e) =>
                                                setFormState({
                                                    ...formState,
                                                    schedule_hour: Math.min(
                                                        23,
                                                        Math.max(0, Number(e.target.value) || 0),
                                                    ),
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="backup_minute" className="text-xs">
                                            每日执行分钟 (0-59)
                                        </Label>
                                        <Input
                                            id="backup_minute"
                                            name="schedule_minute"
                                            type="number"
                                            min={0}
                                            max={59}
                                            value={formState.schedule_minute}
                                            onChange={(e) =>
                                                setFormState({
                                                    ...formState,
                                                    schedule_minute: Math.min(
                                                        59,
                                                        Math.max(0, Number(e.target.value) || 0),
                                                    ),
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="col-span-2 flex items-end sm:col-span-1">
                                        <div className="flex w-full items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                                            <Checkbox
                                                id="include_tsdb_chk"
                                                checked={formState.include_tsdb}
                                                onCheckedChange={(v) =>
                                                    setFormState({
                                                        ...formState,
                                                        include_tsdb: Boolean(v),
                                                    })
                                                }
                                            />
                                            <Label
                                                htmlFor="include_tsdb_chk"
                                                className="cursor-pointer text-xs leading-tight"
                                            >
                                                附带 TSDB 延迟图表（默认不勾选）
                                            </Label>
                                        </div>
                                    </div>
                                </div>

                                {/* AES-256 加密密码 */}
                                <div className="space-y-1.5 rounded-lg border bg-muted/15 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <Label
                                            htmlFor="backup_encrypt_password"
                                            className="flex items-center gap-1.5 text-xs font-semibold"
                                        >
                                            <Lock className="h-3.5 w-3.5 text-primary" />
                                            备份包 AES-256 加密密码（强烈建议填写，防止 API Key 与密钥泄露）
                                        </Label>
                                        {cfg?.has_encrypt_password && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setFormState({
                                                        ...formState,
                                                        encrypt_password: "__CLEAR__",
                                                    })
                                                }
                                                className="text-[11px] text-muted-foreground underline hover:text-destructive"
                                            >
                                                清除密码
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            id="backup_encrypt_password"
                                            name="encrypt_password"
                                            type={showEncryptPwd ? "text" : "password"}
                                            autoComplete="new-password"
                                            value={
                                                formState.encrypt_password === "__CLEAR__"
                                                    ? ""
                                                    : formState.encrypt_password
                                            }
                                            onChange={(e) =>
                                                setFormState({
                                                    ...formState,
                                                    encrypt_password: e.target.value,
                                                })
                                            }
                                            placeholder="输入一个你自己记得住的口令（留空则导出普通 .tar.gz）"
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            aria-pressed={showEncryptPwd}
                                            aria-label={showEncryptPwd ? "隐藏密码" : "显示密码"}
                                            onClick={() => setShowEncryptPwd((s) => !s)}
                                        >
                                            {showEncryptPwd ? (
                                                <EyeOff className="h-4 w-4" />
                                            ) : (
                                                <Eye className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                        采用 OpenSSL 标准 AES-256-CBC (PBKDF2-SHA256) 格式，既支持本页面一键导入自动解密，也支持任意 Linux 新机直接用{" "}
                                        <code>openssl</code> 解密。
                                    </p>
                                </div>

                                {/* Telegram 机器人复用开关 */}
                                <div className="space-y-2.5 rounded-lg border p-3">
                                    <div className="flex items-center gap-2">
                                        <Checkbox
                                            id="use_ai_ops_tg_chk"
                                            checked={formState.use_ai_ops_telegram}
                                            onCheckedChange={(v) =>
                                                setFormState({
                                                    ...formState,
                                                    use_ai_ops_telegram: Boolean(v),
                                                })
                                            }
                                        />
                                        <Label
                                            htmlFor="use_ai_ops_tg_chk"
                                            className="cursor-pointer text-xs font-medium"
                                        >
                                            自动复用「🤖 AI 运维助手」里已经绑定的 Telegram 机器人和管理员 Chat ID（免重复填！）
                                        </Label>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                        当前生效通道：{cfg?.effective_telegram_hint || "读取中..."}
                                    </p>

                                    {!formState.use_ai_ops_telegram && (
                                        <div className="grid grid-cols-1 gap-2.5 pt-1 sm:grid-cols-2">
                                            <div className="space-y-1">
                                                <Label htmlFor="backup_tg_token" className="text-xs">
                                                    独立备份机器人 Bot Token
                                                </Label>
                                                <Input
                                                    id="backup_tg_token"
                                                    name="telegram_bot_token"
                                                    type="password"
                                                    autoComplete="off"
                                                    value={formState.telegram_bot_token}
                                                    onChange={(e) =>
                                                        setFormState({
                                                            ...formState,
                                                            telegram_bot_token: e.target.value,
                                                        })
                                                    }
                                                    placeholder="123456:ABC-DEF..."
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="backup_tg_chat_id" className="text-xs">
                                                    接收备份的管理员 Chat ID
                                                </Label>
                                                <Input
                                                    id="backup_tg_chat_id"
                                                    name="telegram_chat_id"
                                                    autoCorrect="off"
                                                    autoCapitalize="none"
                                                    spellCheck={false}
                                                    value={formState.telegram_chat_id}
                                                    onChange={(e) =>
                                                        setFormState({
                                                            ...formState,
                                                            telegram_chat_id: e.target.value,
                                                        })
                                                    }
                                                    placeholder="例如：5279033136"
                                                />
                                            </div>
                                            <div className="space-y-1 sm:col-span-2">
                                                <Label htmlFor="backup_tg_endpoint" className="text-xs">
                                                    Telegram API 地址（默认官方即可）
                                                </Label>
                                                <Input
                                                    id="backup_tg_endpoint"
                                                    name="telegram_endpoint"
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
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {cfg?.last_backup_message && (
                                    <div
                                        role="status"
                                        className={`rounded-lg border px-3 py-2 text-xs ${
                                            cfg.last_backup_status === "ok"
                                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                                                : "border-destructive/30 bg-destructive/10 text-destructive"
                                        }`}
                                    >
                                        <strong>最近记录：</strong>
                                        {cfg.last_backup_message}
                                    </div>
                                )}

                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <Button
                                        type="submit"
                                        size="sm"
                                        disabled={savingCfg}
                                        className="gap-1.5"
                                    >
                                        {savingCfg ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Save className="h-3.5 w-3.5" />
                                        )}
                                        保存备份设置
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        disabled={sendingTg}
                                        onClick={handleSendTelegramNow}
                                        className="gap-1.5"
                                    >
                                        {sendingTg ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Send className="h-3.5 w-3.5" />
                                        )}
                                        立即发一份到 Telegram
                                    </Button>
                                </div>
                            </fieldset>
                        </form>

                        {/* 右：后台一键本地下载 & 在线导入还原 */}
                        <div className="space-y-4 lg:col-span-5">
                            {/* 本地一键导出 */}
                            <div className="space-y-3 rounded-xl border bg-card p-4">
                                <h2 className="flex items-center gap-2 text-sm font-bold">
                                    <Download className="h-4 w-4 text-primary" />
                                    <span>一键导出下载到电脑本地</span>
                                </h2>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                    实时通过 SQLite <code>VACUUM INTO</code> 生成一致性热快照，内含{" "}
                                    <code>config.yaml</code>、<code>sqlite.db</code>、
                                    <code>docker-compose.yaml</code>、<code>restore.sh</code>{" "}
                                    以及中文搬家说明（是否含 TSDB 与是否加密跟随左侧设置）。
                                </p>
                                <Button
                                    type="button"
                                    onClick={handleExportLocal}
                                    disabled={exporting}
                                    className="w-full gap-1.5"
                                >
                                    {exporting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Download className="h-4 w-4" />
                                    )}
                                    立即打包下载备份文件
                                </Button>
                            </div>

                            {/* 本地一键上传导入还原 */}
                            <div className="space-y-3 rounded-xl border border-amber-500/35 bg-card p-4">
                                <h2 className="flex items-center gap-2 text-sm font-bold">
                                    <Upload className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                    <span>上传备份包一键在线还原</span>
                                </h2>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                    支持直接上传本系统导出的 <code>.tar.gz</code> 或加密包{" "}
                                    <code>.tar.gz.enc</code>（含 TG 里存的历史包）。覆盖前会自动把当前旧数据留档到{" "}
                                    <code>data/pre-restore-*</code>，覆盖完成后容器自动重启生效。
                                </p>

                                <div className="space-y-1.5">
                                    <Label htmlFor="restore_file_input" className="text-xs">
                                        选择备份文件（.tar.gz 或 .tar.gz.enc）
                                    </Label>
                                    <Input
                                        id="restore_file_input"
                                        name="file"
                                        type="file"
                                        accept=".gz,.tgz,.enc"
                                        onChange={(e) =>
                                            setRestoreFile(e.target.files?.[0] ?? null)
                                        }
                                        className="cursor-pointer text-xs file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-primary"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="restore_password_input" className="text-xs">
                                        解密密码（未加密的 .tar.gz 可留空）
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            id="restore_password_input"
                                            name="password"
                                            type={showRestorePwd ? "text" : "password"}
                                            autoComplete="off"
                                            value={restorePwd}
                                            onChange={(e) => setRestorePwd(e.target.value)}
                                            placeholder="若备份包为 .enc 加密文件，请填入当时设的口令"
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            aria-pressed={showRestorePwd}
                                            aria-label={showRestorePwd ? "隐藏解密密码" : "显示解密密码"}
                                            onClick={() => setShowRestorePwd((s) => !s)}
                                        >
                                            {showRestorePwd ? (
                                                <EyeOff className="h-4 w-4" />
                                            ) : (
                                                <Eye className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                </div>

                                {restoreNotice && (
                                    <div
                                        role="status"
                                        className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 p-2.5 text-xs text-emerald-800 dark:text-emerald-200"
                                    >
                                        ✅ {restoreNotice}
                                    </div>
                                )}

                                <Button
                                    type="button"
                                    variant="destructive"
                                    disabled={!restoreFile || restoring}
                                    onClick={() => restoreDialogRef.current?.showModal()}
                                    className="w-full gap-1.5"
                                >
                                    {restoring ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <RefreshCw className="h-4 w-4" />
                                    )}
                                    校验并覆盖还原数据（自动重启）
                                </Button>
                            </div>
                        </div>
                    </div>
                </TabsContent>

                {/* ==================== TAB 2: 一键搬家指南 ==================== */}
                <TabsContent value="guide" className="mt-0 space-y-4">
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs leading-relaxed">
                        <div className="font-bold text-emerald-700 dark:text-emerald-300">
                            🎉 好消息：你的 Agent 接入地址已经是域名 <code>{installHostDisplay}</code>！
                        </div>
                        <p className="mt-1 text-muted-foreground">
                            换新服务器或遇到老商家跑路时，<strong>完全不需要一台台去重装小鸡</strong>！按下面 3 步把数据还原到新小鸡并把域名 DNS 指向新 IP，全部{" "}
                            <strong>{cfg?.total_servers ?? 0} 台小鸡</strong>会在 10 秒内自动全部重连归队，连 AI 配置、TG 机器人、历史流量、警报规则全都在！
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="space-y-2.5 rounded-xl border bg-card p-4">
                            <div className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                                第 1 步 · 准备备份包与镜像
                            </div>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                                ① 拿到最新一份备份包（直接点「备份与还原」本地下载，或从手机{" "}
                                <strong>Telegram 机器人私聊</strong>下载昨晚自动推给你的包）。
                            </p>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                                ② 如果旧机器还活着，顺手把你本地定制镜像也导出来传给新机器（不用重编译！）：
                            </p>
                            <div className="relative rounded-lg border bg-muted/40 p-2.5 font-mono text-[11px]">
                                <pre className="overflow-x-auto pr-8">{oldVpsSaveImageCmd}</pre>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label="复制导出镜像命令"
                                    onClick={() => copyCommand(oldVpsSaveImageCmd, "导出镜像命令")}
                                    className="absolute top-1.5 right-1.5 h-6 w-6"
                                >
                                    <Copy className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2.5 rounded-xl border bg-card p-4">
                            <div className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                                第 2 步 · 新服务器一键还原拉起
                            </div>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                                把备份包（及可选的 <code>nezha-image.tar.gz</code>）上传到新机器后，粘贴执行下方命令即可自动解压、赋权、导入镜像并启动面板：
                            </p>
                            <div className="relative rounded-lg border bg-muted/40 p-2.5 font-mono text-[11px]">
                                <pre className="overflow-x-auto pr-8 whitespace-pre-wrap">
                                    {newVpsRestoreCmd}
                                </pre>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label="复制一键恢复命令"
                                    onClick={() => copyCommand(newVpsRestoreCmd, "一键恢复命令")}
                                    className="absolute top-1.5 right-1.5 h-6 w-6"
                                >
                                    <Copy className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2.5 rounded-xl border bg-card p-4">
                            <div className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                                第 3 步 · 切换 DNS 全群自动归队
                            </div>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                                在你的域名解析商（如 Cloudflare）把{" "}
                                <code>{installHostDisplay.split(":")[0]}</code> 的 A 记录改为新服务器 IP，并在新机器放行{" "}
                                <code>{listenPort}</code> 端口及配置 HTTPS 反向代理。
                            </p>
                            <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-2.5 text-xs text-muted-foreground">
                                💡 <strong>或者更省事</strong>：如果你已经在新机器上跑起了一个空白的定制版哪吒面板，直接登录新面板打开本页面，在「备份与还原」里直接<strong>网页上传备份包</strong>，5 秒搞定！
                            </div>
                        </div>
                    </div>
                </TabsContent>

                {/* ==================== TAB 3: 换新域名时批量改小鸡 Agent 地址 ==================== */}
                <TabsContent value="agents" className="mt-0 space-y-4">
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs leading-relaxed">
                        <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                            <ShieldAlert className="h-4 w-4" />
                            <span>什么时候需要用到这个功能？（换新域名 / 换新端口专用）</span>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                            如果你只是换服务器但<strong>域名依然沿用 <code>{installHostDisplay}</code></strong>，根本不用动小鸡！只有当你<strong>想换一个全新的面板域名或端口号</strong>时，才用这个工具趁旧面板还在线，批量帮所有小鸡把{" "}
                            <code>config.yml</code> 指向新地址。强烈建议<strong>先勾选 1 台测试小鸡试迁成功，再全选其余机器</strong>！
                        </p>
                    </div>

                    <div className="space-y-4 rounded-xl border bg-card p-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                            <div className="space-y-1 sm:col-span-6">
                                <Label htmlFor="new_agent_server" className="text-xs font-semibold">
                                    新的面板接入地址（域名:端口 或 IP:端口）
                                </Label>
                                <Input
                                    id="new_agent_server"
                                    name="new_server"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    value={newServerAddr}
                                    onChange={(e) => setNewServerAddr(e.target.value)}
                                    placeholder={`例如：new-probe.example.com:${listenPort}`}
                                />
                            </div>
                            <div className="flex items-end sm:col-span-3">
                                <div className="flex w-full items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                                    <Checkbox
                                        id="new_agent_tls_chk"
                                        checked={newUseTLS}
                                        onCheckedChange={(v) => setNewUseTLS(Boolean(v))}
                                    />
                                    <Label
                                        htmlFor="new_agent_tls_chk"
                                        className="cursor-pointer text-xs"
                                    >
                                        新地址开启 gRPC TLS
                                    </Label>
                                </div>
                            </div>
                            <div className="flex items-end sm:col-span-3">
                                <Button
                                    type="button"
                                    disabled={
                                        migrating ||
                                        selectedServerIds.length === 0 ||
                                        !newServerAddr.trim()
                                    }
                                    onClick={() => migrateDialogRef.current?.showModal()}
                                    className="w-full gap-1.5"
                                >
                                    {migrating ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Truck className="h-4 w-4" />
                                    )}
                                    迁移选中 ({selectedServerIds.length} 台)
                                </Button>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">
                                可迁移的在线 Linux 服务器：<strong>{onlineLinuxServers.length} 台</strong>
                            </span>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                        setSelectedServerIds(onlineLinuxServers.map((s) => s.id))
                                    }
                                    className="h-7 text-xs"
                                >
                                    全选在线 Linux
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setSelectedServerIds([])}
                                    className="h-7 text-xs"
                                >
                                    清空选择
                                </Button>
                            </div>
                        </div>

                        <div
                            tabIndex={0}
                            role="region"
                            aria-label="可迁移服务器列表"
                            className="max-h-72 overflow-auto rounded-lg border focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
                        >
                            <table className="w-full border-separate border-spacing-0 text-left text-xs">
                                <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-xs">
                                    <tr>
                                        <th scope="col" className="w-10 border-b px-3 py-2">
                                            选择
                                        </th>
                                        <th scope="col" className="border-b px-3 py-2 font-semibold">
                                            服务器名称
                                        </th>
                                        <th scope="col" className="border-b px-3 py-2 font-semibold">
                                            系统平台
                                        </th>
                                        <th scope="col" className="border-b px-3 py-2 font-semibold">
                                            状态
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {(servers ?? []).map((srv) => {
                                        const online = isServerOnline(srv)
                                        const win = isWindowsServer(srv)
                                        const disabled = !online || win
                                        const checked = selectedServerIds.includes(srv.id)
                                        return (
                                            <tr
                                                key={srv.id}
                                                className={
                                                    disabled
                                                        ? "opacity-50"
                                                        : "hover:bg-muted/30"
                                                }
                                            >
                                                <td className="px-3 py-2">
                                                    <Checkbox
                                                        id={`mig-srv-${srv.id}`}
                                                        disabled={disabled}
                                                        checked={checked}
                                                        onCheckedChange={() =>
                                                            toggleServerSelection(srv.id)
                                                        }
                                                        aria-label={`选择 ${srv.name}`}
                                                    />
                                                </td>
                                                <td className="px-3 py-2 font-medium">
                                                    <label
                                                        htmlFor={`mig-srv-${srv.id}`}
                                                        className={
                                                            disabled
                                                                ? "cursor-not-allowed"
                                                                : "cursor-pointer"
                                                        }
                                                    >
                                                        {srv.name} (#{srv.id})
                                                    </label>
                                                </td>
                                                <td className="px-3 py-2 text-muted-foreground">
                                                    {srv.host?.platform || "Unknown"}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {win ? (
                                                        <span className="text-muted-foreground">
                                                            Windows 需手动修改
                                                        </span>
                                                    ) : online ? (
                                                        <span className="text-emerald-600 dark:text-emerald-400">
                                                            ● 在线可迁
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground">
                                                            ○ 离线
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {migrateResults.length > 0 && (
                            <div
                                tabIndex={0}
                                role="region"
                                aria-label="批量迁移结果"
                                className="overflow-auto rounded-lg border"
                            >
                                <table className="w-full border-separate border-spacing-0 text-left text-xs">
                                    <thead className="sticky top-0 z-10 bg-muted/95">
                                        <tr>
                                            <th scope="col" className="border-b px-3 py-2">
                                                服务器
                                            </th>
                                            <th scope="col" className="border-b px-3 py-2">
                                                结果
                                            </th>
                                            <th scope="col" className="border-b px-3 py-2">
                                                详情
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {migrateResults.map((r) => (
                                            <tr key={r.server_id}>
                                                <td className="px-3 py-2 font-medium">
                                                    {r.server_name || `#${r.server_id}`}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {r.success ? (
                                                        <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                                            成功
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 font-medium text-destructive">
                                                            <XCircle className="h-3.5 w-3.5" />
                                                            失败
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-muted-foreground">
                                                    {r.message}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </TabsContent>
            </Tabs>

            {/* 原生 <dialog> 确认弹窗 1：备份覆盖还原（安全取消按钮默认 autofocus） */}
            <dialog
                ref={restoreDialogRef}
                aria-labelledby={restoreTitleId}
                onClose={handleRestoreDialogClose}
                className="m-auto w-[min(92vw,440px)] rounded-xl border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/55 backdrop:backdrop-blur-xs"
            >
                <h2 id={restoreTitleId} className="text-base font-bold">
                    确认覆盖当前面板数据并自动重启？
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    即将导入备份文件 <strong>{restoreFile?.name}</strong>。系统会先自动将当前的{" "}
                    <code>config.yaml</code> 与 <code>sqlite.db</code> 备份留档到{" "}
                    <code>data/pre-restore-*</code>，覆盖成功后容器将在 2 秒内自动重启加载新数据。
                </p>
                <form method="dialog" className="mt-4 flex justify-end gap-2">
                    <Button type="submit" value="cancel" variant="outline" size="sm" autoFocus>
                        取消（不改动）
                    </Button>
                    <Button type="submit" value="confirm" variant="destructive" size="sm">
                        确认覆盖并还原
                    </Button>
                </form>
            </dialog>

            {/* 原生 <dialog> 确认弹窗 2：批量修改小鸡 Agent 接入地址 */}
            <dialog
                ref={migrateDialogRef}
                aria-labelledby={migrateTitleId}
                onClose={handleMigrateDialogClose}
                className="m-auto w-[min(92vw,460px)] rounded-xl border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/55 backdrop:backdrop-blur-xs"
            >
                <h2 id={migrateTitleId} className="text-base font-bold">
                    确认将 {selectedServerIds.length} 台小鸡切换至新面板？
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    即将把选中小鸡的 <code>nezha-agent</code> 连接地址修改为{" "}
                    <code className="font-semibold text-primary">{newServerAddr}</code>（TLS:{" "}
                    {newUseTLS ? "开启" : "关闭"}），原配置文件会先备份成 <code>.bak</code>，2 秒后重启 Agent。请确保新面板已经用相同{" "}
                    <code>agent_secret_key</code> 跑起来！
                </p>
                <form method="dialog" className="mt-4 flex justify-end gap-2">
                    <Button type="submit" value="cancel" variant="outline" size="sm" autoFocus>
                        先取消检查一下
                    </Button>
                    <Button type="submit" value="confirm" variant="destructive" size="sm">
                        确认批量切换
                    </Button>
                </form>
            </dialog>
        </div>
    )
}
