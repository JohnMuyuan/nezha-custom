import "webauthn-polyfills"

import {
    AuthPolicyResponse,
    beginPasskeyLogin,
    completePasskeyLoginTOTP,
    finishPasskeyLoginRaw,
    getAuthPolicy,
    signalUnknownCredentialSafe,
} from "@/api/passkey"
import { Button } from "@/components/ui/button"
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
import { useAuth } from "@/hooks/useAuth"
import { zodResolver } from "@hookform/resolvers/zod"
import i18next from "i18next"
import {
    ArrowLeft,
    Eye,
    EyeOff,
    Fingerprint,
    KeyRound,
    Loader2,
    Lock,
    ShieldCheck,
} from "lucide-react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

const formSchema = z.object({
    username: z.string().min(2, {
        message: i18next.t("Results.UsernameMin", { number: 2 }),
    }),
    password: z.string().min(1, {
        message: i18next.t("Results.PasswordRequired"),
    }),
})

type PendingTOTPState =
    | { mode: "password"; username: string; password: string }
    | { mode: "passkey"; username: string; pendingToken: string }

function Login() {
    const { login, completePasskeyAuth } = useAuth()
    const { t } = useTranslation()

    const [policy, setPolicy] = useState<AuthPolicyResponse | null>(null)
    const [showPassword, setShowPassword] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [passkeyBusy, setPasskeyBusy] = useState(false)

    // Step 2: 2FA TOTP verification state (for new-device Passkey login or emergency password login)
    const [pendingTOTP, setPendingTOTP] = useState<PendingTOTPState | null>(null)
    const [totpCode, setTotpCode] = useState("")
    const [useRecoveryCode, setUseRecoveryCode] = useState(false)
    const totpInputRef = useRef<HTMLInputElement>(null)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        let alive = true
        getAuthPolicy()
            .then((res) => {
                if (alive) setPolicy(res)
            })
            .catch(() => {
                // Fail closed to Passkey-only UI if policy fetch fails
                if (alive) {
                    setPolicy({
                        single_admin: true,
                        passkey_available: true,
                        passkey_only: true,
                        password_login_enabled: false,
                        oauth2_enabled: false,
                        emergency_password_override: false,
                        rp_id: "",
                    })
                }
            })
        return () => {
            alive = false
            abortRef.current?.abort()
        }
    }, [])

    useEffect(() => {
        if (pendingTOTP) {
            totpInputRef.current?.focus()
        }
    }, [pendingTOTP, useRecoveryCode])

    const handlePasskeyServerVerify = useCallback(
        async (challengeId: string, serverRpId: string, encodedCredential: any) => {
            try {
                const res = await finishPasskeyLoginRaw(challengeId, encodedCredential)
                if (!res.ok) {
                    if (res.status === 404) {
                        await signalUnknownCredentialSafe(serverRpId, encodedCredential?.id)
                        toast.error("该 Passkey 未绑定或已被删除，请选择其他密钥")
                    } else {
                        toast.error("Passkey 登录失败", { description: res.error })
                    }
                    return
                }

                const data = res.data
                if (data?.totp_required && data.pending_token) {
                    setPendingTOTP({
                        mode: "passkey",
                        username: data.username || "管理员",
                        pendingToken: data.pending_token,
                    })
                    setTotpCode("")
                    setUseRecoveryCode(false)
                    return
                }

                if (data?.ok) {
                    if (data.trusted_device) {
                        toast.success("老设备 Passkey 验证通过，免 2FA 直接登录")
                    } else {
                        toast.success("Passkey 登录成功")
                    }
                    await completePasskeyAuth()
                }
            } catch (err: any) {
                toast.error("Passkey 登录请求失败", { description: err?.message })
            }
        },
        [completePasskeyAuth],
    )

    const handleExplicitPasskeyLogin = async () => {
        if (passkeyBusy) return
        const pkc = (window as any).PublicKeyCredential
        if (!pkc || typeof pkc.parseRequestOptionsFromJSON !== "function") {
            toast.error("当前浏览器不支持 Passkey，请使用 HTTPS 及新版 Chrome/Edge/Safari/Firefox")
            return
        }

        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setPasskeyBusy(true)
        try {
            const begin = await beginPasskeyLogin()
            const publicKey = pkc.parseRequestOptionsFromJSON(begin.publicKey)
            const serverRpId = publicKey?.rpId || begin.rp_id

            let credential: any
            try {
                credential = await navigator.credentials.get({
                    publicKey,
                    signal: controller.signal,
                })
            } catch (err: any) {
                if (err?.name === "NotAllowedError" || err?.name === "AbortError") {
                    return
                }
                toast.error("调用 Passkey 失败", { description: err?.message })
                return
            }

            if (!credential || typeof credential.toJSON !== "function") {
                toast.error("未收到有效的 Passkey 认证响应")
                return
            }

            await handlePasskeyServerVerify(begin.challenge_id, serverRpId, credential.toJSON())
        } catch (err: any) {
            toast.error("发起 Passkey 登录失败", { description: err?.message })
        } finally {
            setPasskeyBusy(false)
        }
    }

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            username: "",
            password: "",
        },
    })

    async function onSubmitEmergencyPassword(values: z.infer<typeof formSchema>) {
        if (submitting) return
        setSubmitting(true)
        try {
            const res = await login(values.username, values.password)
            if (res === "totp_required") {
                setPendingTOTP({
                    mode: "password",
                    username: values.username,
                    password: values.password,
                })
                setTotpCode("")
                setUseRecoveryCode(false)
            }
        } finally {
            setSubmitting(false)
        }
    }

    async function onSubmitTOTP(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!pendingTOTP || submitting) return
        const cleaned = totpCode.trim()
        if (!cleaned) return
        setSubmitting(true)
        try {
            if (pendingTOTP.mode === "passkey") {
                try {
                    const res = await completePasskeyLoginTOTP(pendingTOTP.pendingToken, cleaned)
                    if (res?.ok) {
                        toast.success("新设备 2FA 验证通过，已自动信任此设备 180 天")
                        await completePasskeyAuth()
                    }
                } catch (err: any) {
                    const msg = err?.message
                    if (msg === "ApiErrorTOTPInvalid") {
                        toast.error("6 位动态验证码（或恢复码）不正确或已过期，请重试")
                    } else {
                        toast.error(msg || "验证失败，请重试")
                    }
                    setTotpCode("")
                    totpInputRef.current?.focus()
                }
                return
            }

            const res = await login(pendingTOTP.username, pendingTOTP.password, cleaned)
            if (res === "totp_invalid") {
                setTotpCode("")
                totpInputRef.current?.focus()
            }
        } finally {
            setSubmitting(false)
        }
    }

    // Step 2: 2FA Verification (new device after Passkey, or emergency break-glass login)
    if (pendingTOTP) {
        const isNewDevicePasskey = pendingTOTP.mode === "passkey"
        return (
            <div className="m-auto mt-24 max-w-xs sm:max-w-sm">
                <div className="rounded-xl border bg-card p-6 shadow-xs">
                    <div className="mb-4 flex items-center gap-2.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                            <h1 className="text-base font-bold">
                                {isNewDevicePasskey ? "新设备二次验证（2FA）" : "两步验证（2FA）"}
                            </h1>
                            <p className="text-xs text-muted-foreground">
                                正在登录管理员：<strong>{pendingTOTP.username}</strong>
                            </p>
                        </div>
                    </div>

                    {isNewDevicePasskey && (
                        <p className="mb-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                            ✅ Passkey 已验证通过。检测到这是新设备，完成本次 2FA 后将自动记住该设备{" "}
                            <strong>180 天</strong>，以后掉登录只需 Passkey 即可秒进。
                        </p>
                    )}

                    <form onSubmit={onSubmitTOTP} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="login-totp-input" className="text-xs font-semibold">
                                {useRecoveryCode ? "8 位应急恢复码" : "6 位动态验证码"}
                            </Label>
                            <p id="login-totp-hint" className="text-xs text-muted-foreground">
                                {useRecoveryCode
                                    ? "请输入启用 2FA 时保存的一次性恢复码（如 A1B2-C3D4），用过即失效。"
                                    : "请打开手机身份验证器（Google / Apple 密码 / Vaultwarden 等），输入当前 6 位数字验证码。"}
                            </p>
                            <Input
                                ref={totpInputRef}
                                id="login-totp-input"
                                name="totp_code"
                                type="text"
                                inputMode={useRecoveryCode ? "text" : "numeric"}
                                autoComplete="one-time-code"
                                autoCorrect="off"
                                autoCapitalize="characters"
                                spellCheck={false}
                                enterKeyHint="done"
                                pattern={useRecoveryCode ? "[A-Za-z0-9-]{8,9}" : "\\d{6}"}
                                maxLength={useRecoveryCode ? 9 : 6}
                                aria-describedby="login-totp-hint"
                                required
                                value={totpCode}
                                onChange={(e) => {
                                    const v = e.target.value
                                    setTotpCode(
                                        useRecoveryCode
                                            ? v.toUpperCase().replace(/[^A-Z0-9-]/g, "")
                                            : v.replace(/\D/g, "").slice(0, 6),
                                    )
                                }}
                                placeholder={useRecoveryCode ? "A1B2-C3D4" : "000000"}
                                className="min-h-[48px] text-center font-mono text-xl tracking-[0.35em]"
                            />
                        </div>

                        <Button
                            type="submit"
                            disabled={submitting}
                            className="min-h-[44px] w-full gap-2 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                        >
                            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            验证并登录
                        </Button>

                        <div className="flex items-center justify-between pt-1 text-xs">
                            <button
                                type="button"
                                onClick={() => {
                                    setPendingTOTP(null)
                                    setTotpCode("")
                                }}
                                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            >
                                <ArrowLeft className="h-3.5 w-3.5" />
                                返回登录页
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setUseRecoveryCode((v) => !v)
                                    setTotpCode("")
                                }}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                                <KeyRound className="h-3.5 w-3.5" />
                                {useRecoveryCode ? "改用 6 位验证码" : "使用应急恢复码"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        )
    }

    // Emergency server-side break-glass override ONLY (NZ_EMERGENCY_ALLOW_PASSWORD=1)
    if (policy?.emergency_password_override) {
        return (
            <div className="m-auto mt-24 max-w-xs sm:max-w-sm">
                <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    ⚠️ 应急救砖模式已启用（<code>NZ_EMERGENCY_ALLOW_PASSWORD=1</code>），密码登录已临时开放。请登录后立即补绑新 Passkey 并移除该环境变量。
                </div>
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmitEmergencyPassword)}
                        className="space-y-5"
                    >
                        <FormField
                            control={form.control}
                            name="username"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("Username")}</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="admin"
                                            autoComplete="username"
                                            autoFocus
                                            autoCorrect="off"
                                            autoCapitalize="none"
                                            spellCheck={false}
                                            required
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("Password")}</FormLabel>
                                    <FormControl>
                                        <div className="flex items-center gap-1.5">
                                            <Input
                                                type={showPassword ? "text" : "password"}
                                                placeholder="admin"
                                                autoComplete="current-password"
                                                required
                                                {...field}
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                aria-pressed={showPassword}
                                                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                                                onClick={() => setShowPassword((s) => !s)}
                                            >
                                                {showPassword ? (
                                                    <EyeOff className="h-4 w-4" />
                                                ) : (
                                                    <Eye className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </div>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button
                            type="submit"
                            disabled={submitting}
                            className="w-full gap-2 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                        >
                            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            应急密码登录
                        </Button>
                    </form>
                </Form>
            </div>
        )
    }

    // Default & Permanent Passkey-Only Sign-In Screen (zero username/password inputs, zero OAuth2)
    return (
        <div className="m-auto mt-24 max-w-xs sm:max-w-sm">
            <div className="space-y-5 rounded-xl border bg-card p-6 text-center shadow-xs">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Fingerprint className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                    <h1 className="text-lg font-bold">管理员 Passkey 登录</h1>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        已彻底关闭账号密码与 OAuth2 登录，仅支持 Passkey。
                        <br />
                        老设备只需 Passkey 一键进入，新设备将自动触发 6 位 2FA 验证。
                    </p>
                </div>
                <Button
                    type="button"
                    disabled={passkeyBusy}
                    onClick={() => void handleExplicitPasskeyLogin()}
                    className="min-h-[46px] w-full gap-2 rounded-lg text-sm font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                >
                    {passkeyBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Fingerprint className="h-4 w-4" />
                    )}
                    使用 Passkey 登录
                </Button>
                <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    <span>单管理员模式 · 端到端防钓鱼硬件验签</span>
                </p>
            </div>
        </div>
    )
}

export default Login
