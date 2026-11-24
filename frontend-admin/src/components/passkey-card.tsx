import "webauthn-polyfills"

import {
    PasskeyCredentialView,
    PasskeyListResponse,
    TrustedDeviceView,
    beginPasskeyRegister,
    deletePasskey,
    finishPasskeyRegisterRaw,
    listPasskeys,
    listTrustedDevices,
    renamePasskey,
    revokeAllTrustedDevices,
    revokeTrustedDevice,
    signalAllAcceptedCredentialsSafe,
    signalUnknownCredentialSafe,
} from "@/api/passkey"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useMainStore } from "@/hooks/useMainStore"
import { lookupPasskeyProvider } from "@/lib/aaguid-map"
import {
    Check,
    Fingerprint,
    KeyRound,
    Laptop,
    Loader2,
    Lock,
    Pencil,
    Plus,
    ShieldAlert,
    ShieldCheck,
    Trash2,
    X,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

function formatDateTime(ts?: number): string {
    if (!ts) return "尚未使用"
    try {
        return new Date(ts).toLocaleString()
    } catch {
        return "—"
    }
}

export function PasskeySecurityCard() {
    const { profile } = useMainStore()
    const [loading, setLoading] = useState(true)
    const [passkeyData, setPasskeyData] = useState<PasskeyListResponse | null>(null)
    const [trustedDevices, setTrustedDevices] = useState<TrustedDeviceView[]>([])
    const [passkeySupported, setPasskeySupported] = useState(false)

    const [registering, setRegistering] = useState(false)
    const [newKeyName, setNewKeyName] = useState("")
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editingName, setEditingName] = useState("")
    const [busyId, setBusyId] = useState<string | null>(null)
    const [deviceBusy, setDeviceBusy] = useState(false)

    // Detect WebAuthn platform / passkey capability via getClientCapabilities()
    useEffect(() => {
        let alive = true
        async function detect() {
            const pkc = (window as any).PublicKeyCredential
            if (!pkc) {
                if (alive) setPasskeySupported(false)
                return
            }
            if (typeof pkc.getClientCapabilities === "function") {
                try {
                    const caps = await pkc.getClientCapabilities()
                    // Allow creation if platform authenticator OR conditionalGet OR general WebAuthn is available
                    const ok = Boolean(
                        caps?.passkeyPlatformAuthenticator ||
                            caps?.conditionalGet ||
                            caps?.hybridTransport,
                    )
                    if (alive) setPasskeySupported(ok)
                    return
                } catch {
                    // Fallback to basic PublicKeyCredential presence
                }
            }
            if (alive) setPasskeySupported(true)
        }
        void detect()
        return () => {
            alive = false
        }
    }, [])

    const refreshAll = useCallback(async (syncSignal = false) => {
        try {
            const [pkResp, devResp] = await Promise.all([listPasskeys(), listTrustedDevices()])
            setPasskeyData(pkResp)
            setTrustedDevices(devResp || [])
            if (syncSignal && pkResp) {
                await signalAllAcceptedCredentialsSafe(
                    pkResp.rp_id,
                    pkResp.user_id,
                    (pkResp.credentials || []).map((c) => c.id),
                )
            }
        } catch (err: any) {
            toast.error("加载 Passkey 与受信任设备失败", { description: err?.message })
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        if (profile) {
            void refreshAll(true)
        }
    }, [profile, refreshAll])

    if (!profile) return null

    const credentials: PasskeyCredentialView[] = passkeyData?.credentials || []

    const handleRegisterPasskey = async () => {
        if (registering) return
        const pkc = (window as any).PublicKeyCredential
        if (!pkc || typeof pkc.parseCreationOptionsFromJSON !== "function") {
            toast.error("当前浏览器不支持 Passkey 注册，请使用 HTTPS 及新版 Chrome/Edge/Safari/Firefox")
            return
        }

        setRegistering(true)
        try {
            const begin = await beginPasskeyRegister()
            const publicKey = pkc.parseCreationOptionsFromJSON(begin.publicKey)

            let credential: any
            try {
                credential = await navigator.credentials.create({ publicKey })
            } catch (err: any) {
                if (err?.name === "InvalidStateError") {
                    toast.info("当前验证器已经为该账号绑定过 Passkey，无需重复创建")
                } else if (err?.name === "SecurityError") {
                    toast.error("安全上下文或域名校验失败（Passkey 必须在 HTTPS 域名下使用）")
                } else if (err?.name === "NotAllowedError" || err?.name === "AbortError") {
                    // User cancelled or timed out — do not call signalUnknownCredential
                } else {
                    toast.error("创建 Passkey 失败", { description: err?.message })
                }
                return
            }

            if (!credential || typeof credential.toJSON !== "function") {
                toast.error("浏览器未返回有效的 Passkey 凭据")
                return
            }

            const encodedResponse = credential.toJSON()
            const serverRpId = publicKey?.rp?.id || begin.rp_id
            try {
                const verifyRes = await finishPasskeyRegisterRaw(
                    begin.challenge_id,
                    encodedResponse,
                    newKeyName.trim(),
                )
                if (!verifyRes.ok) {
                    await signalUnknownCredentialSafe(serverRpId, encodedResponse.id)
                    toast.error("Passkey 注册校验失败", { description: verifyRes.error })
                    return
                }
            } catch (serverErr: any) {
                await signalUnknownCredentialSafe(serverRpId, encodedResponse.id)
                toast.error("Passkey 注册网络异常", { description: serverErr?.message })
                return
            }

            setNewKeyName("")
            toast.success("Passkey 绑定成功！建议再绑定一把备用设备或同步密码管理器")
            await refreshAll(true)
        } catch (err: any) {
            toast.error("初始化 Passkey 注册失败", { description: err?.message })
        } finally {
            setRegistering(false)
        }
    }

    const handleRename = async (credId: string) => {
        const trimmed = editingName.trim()
        if (!trimmed) return
        setBusyId(credId)
        try {
            await renamePasskey(credId, trimmed)
            setEditingId(null)
            setEditingName("")
            toast.success("已更新 Passkey 名称")
            await refreshAll(false)
        } catch (err: any) {
            toast.error("重命名失败", { description: err?.message })
        } finally {
            setBusyId(null)
        }
    }

    const handleDelete = async (cred: PasskeyCredentialView) => {
        if (!window.confirm(`确认删除 Passkey「${cred.name}」吗？删除后该密钥将无法登录面板。`)) {
            return
        }
        setBusyId(cred.id)
        try {
            await deletePasskey(cred.id)
            toast.success("已删除 Passkey")
            await refreshAll(true)
        } catch (err: any) {
            toast.error("删除失败", { description: err?.message })
        } finally {
            setBusyId(null)
        }
    }

    const handleRevokeDevice = async (dev: TrustedDeviceView) => {
        setDeviceBusy(true)
        try {
            await revokeTrustedDevice(dev.id)
            toast.success(`已撤销设备「${dev.device_name}」的免 2FA 信任`)
            await refreshAll(false)
        } catch (err: any) {
            toast.error("撤销失败", { description: err?.message })
        } finally {
            setDeviceBusy(false)
        }
    }

    const handleRevokeAllDevices = async (keepCurrent: boolean) => {
        const msg = keepCurrent
            ? "确认撤销除当前浏览器以外的所有老设备信任吗？被撤销的设备下次登录都需要重新验证 6 位 2FA。"
            : "确认清空所有受信任老设备吗？包括当前设备在内，下次掉登录时都需要重新输入 6 位 2FA。"
        if (!window.confirm(msg)) return
        setDeviceBusy(true)
        try {
            await revokeAllTrustedDevices(keepCurrent)
            toast.success(keepCurrent ? "已踢掉所有其他受信任设备" : "已清空全部受信任设备")
            await refreshAll(false)
        } catch (err: any) {
            toast.error("操作失败", { description: err?.message })
        } finally {
            setDeviceBusy(false)
        }
    }

    return (
        <div className="space-y-4">
            {/* 卡片 1：Passkey 管理 + 仅限 Passkey 登录锁定 */}
            <Card className="w-full border-primary/25">
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Fingerprint className="h-5 w-5 text-primary" />
                            <span>Passkey 通行密钥 & 单管理员登录策略</span>
                        </CardTitle>
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            🔒 仅限 Passkey 登录（密码与 OAuth2 已拔除）
                        </span>
                    </div>
                </CardHeader>

                <CardContent className="space-y-4 text-xs">
                    {passkeyData?.emergency_password_override && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
                            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            <p>
                                当前检测到紧急救砖环境变量 <code>NZ_EMERGENCY_ALLOW_PASSWORD=1</code>
                                ，密码登录已临时解锁。补绑好新 Passkey 后请记得从{" "}
                                <code>docker-compose.yaml</code> 移除该变量并重启容器。
                            </p>
                        </div>
                    )}

                    {/* 永久仅限 Passkey 状态说明 */}
                    <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
                        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                        <p className="leading-relaxed text-muted-foreground">
                            账号密码登录与 OAuth2 登录入口已彻底拔除，仅保留 Passkey。
                            <strong>老设备（180 天内）掉登录只需 Passkey 一键进入，新设备需额外通过 6 位 2FA 二验</strong>。
                            强烈建议绑定至少 2 把 Passkey 防丢失（万一全丢可通过服务器环境变量{" "}
                            <code>NZ_EMERGENCY_ALLOW_PASSWORD=1</code> 应急救砖）。
                        </p>
                    </div>

                    {/* 新增 Passkey */}
                    {passkeySupported ? (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Input
                                value={newKeyName}
                                onChange={(e) => setNewKeyName(e.target.value)}
                                placeholder="可选备注（如：MacBook Touch ID / iPhone / Windows Hello）"
                                maxLength={80}
                                className="h-9 flex-1 text-xs"
                            />
                            <Button
                                type="button"
                                size="sm"
                                disabled={registering}
                                onClick={() => void handleRegisterPasskey()}
                                className="h-9 shrink-0 gap-1.5"
                            >
                                {registering ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Plus className="h-4 w-4" />
                                )}
                                绑定新 Passkey
                            </Button>
                        </div>
                    ) : (
                        <div className="rounded-lg border border-dashed p-3 text-muted-foreground">
                            当前浏览器环境不支持 Passkey 创建（需 HTTPS 安全上下文及支持 WebAuthn 的现代浏览器）。
                        </div>
                    )}

                    {/* 已绑定的 Passkey 列表 */}
                    {loading ? (
                        <div className="flex items-center gap-2 py-4 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>正在加载已绑定的 Passkey...</span>
                        </div>
                    ) : credentials.length === 0 ? (
                        <div className="rounded-xl border border-dashed bg-muted/15 p-5 text-center text-muted-foreground">
                            暂未绑定任何 Passkey。点击上方「绑定新 Passkey」完成后，即可开启仅限 Passkey 登录。
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {credentials.map((cred) => {
                                const provider = lookupPasskeyProvider(cred.aaguid)
                                const isEditing = editingId === cred.id
                                const isBusy = busyId === cred.id
                                return (
                                    <div
                                        key={cred.id}
                                        className="flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div className="flex min-w-0 items-start gap-3">
                                            <div
                                                aria-hidden="true"
                                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                                                    provider?.accentClass ||
                                                    "bg-primary/10 text-primary"
                                                }`}
                                            >
                                                {provider ? (
                                                    provider.shortCode
                                                ) : (
                                                    <KeyRound className="h-4 w-4" />
                                                )}
                                            </div>
                                            <div className="min-w-0 space-y-1">
                                                {isEditing ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <Input
                                                            value={editingName}
                                                            onChange={(e) =>
                                                                setEditingName(e.target.value)
                                                            }
                                                            maxLength={80}
                                                            className="h-7 w-48 text-xs"
                                                            autoFocus
                                                        />
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="outline"
                                                            className="h-7 w-7"
                                                            disabled={isBusy}
                                                            onClick={() => void handleRename(cred.id)}
                                                            aria-label="保存名称"
                                                        >
                                                            <Check className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-7 w-7"
                                                            onClick={() => setEditingId(null)}
                                                            aria-label="取消重命名"
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <span className="truncate text-sm font-semibold text-foreground">
                                                            {cred.name ||
                                                                provider?.name ||
                                                                "未命名 Passkey"}
                                                        </span>
                                                        {provider && (
                                                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                                                {provider.name}
                                                            </span>
                                                        )}
                                                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                                            {cred.credential_device_type ===
                                                            "multiDevice"
                                                                ? "云同步密钥"
                                                                : "本机硬件绑定"}
                                                        </span>
                                                    </div>
                                                )}
                                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                                                    <span>
                                                        绑定时间：{formatDateTime(cred.registered_at)}
                                                    </span>
                                                    <span>
                                                        最近使用：{formatDateTime(cred.last_used_at)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={isBusy}
                                                onClick={() => {
                                                    setEditingId(cred.id)
                                                    setEditingName(cred.name)
                                                }}
                                                className="h-7 gap-1 px-2 text-xs"
                                            >
                                                <Pencil className="h-3 w-3" />
                                                重命名
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={isBusy || credentials.length <= 1}
                                                onClick={() => void handleDelete(cred)}
                                                className="h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                                删除
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 卡片 2：受信任设备管理（老设备 180 天免 2FA） */}
            <Card className="w-full">
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Laptop className="h-4 w-4 text-primary" />
                            <span>受信任的老设备（180 天内掉登录免 2FA）</span>
                        </CardTitle>
                        {trustedDevices.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {trustedDevices.length > 1 && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={deviceBusy}
                                        onClick={() => void handleRevokeAllDevices(true)}
                                        className="h-7 text-xs"
                                    >
                                        撤销其他设备
                                    </Button>
                                )}
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={deviceBusy}
                                    onClick={() => void handleRevokeAllDevices(false)}
                                    className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                                >
                                    清空全部
                                </Button>
                            </div>
                        )}
                    </div>
                </CardHeader>

                <CardContent className="space-y-3 text-xs">
                    <p className="text-muted-foreground">
                        通过 2FA 验证登录过的浏览器会自动获得 <strong>180 天</strong>
                        受信任凭证（每次登录自动顺延）。在该浏览器掉登录或重新打开面板时，只需验证{" "}
                        <strong>Passkey</strong> 即可直接进入，无需重复输入 6 位验证码；任何未在下方列表中的新设备都必须先过 Passkey 再验 2FA。
                    </p>

                    {trustedDevices.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">
                            当前暂无受信任设备记录（下次通过 2FA 登录会自动登记当前浏览器）。
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {trustedDevices.map((dev) => (
                                <div
                                    key={dev.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2.5"
                                >
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                            <span className="font-semibold text-foreground">
                                                {dev.device_name}
                                            </span>
                                            {dev.is_current && (
                                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                                    当前设备
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                                            <span>最近 IP：{dev.last_ip || "未知"}</span>
                                            <span>
                                                最近活跃：{formatDateTime(dev.last_used_at)}
                                            </span>
                                            <span>到期时间：{formatDateTime(dev.expires_at)}</span>
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={deviceBusy}
                                        onClick={() => void handleRevokeDevice(dev)}
                                        className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    >
                                        撤销信任
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
