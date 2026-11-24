import { TOTPSetupResponse, disableTOTP, enableTOTP, getProfile, setupTOTP } from "@/api/user"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useMainStore } from "@/hooks/useMainStore"
import {
    CheckCircle2,
    Copy,
    Download,
    KeyRound,
    Loader2,
    ShieldCheck,
    ShieldOff,
} from "lucide-react"
import QRCode from "qrcode"
import React, { useEffect, useState } from "react"
import { toast } from "sonner"

export function TotpSecurityCard() {
    const { profile, setProfile } = useMainStore()
    const enabled = Boolean(profile?.totp_enabled)

    const [step, setStep] = useState<"idle" | "setup" | "recovery" | "disable">("idle")
    const [password, setPassword] = useState("")
    const [code, setCode] = useState("")
    const [busy, setBusy] = useState(false)

    const [setupData, setSetupData] = useState<TOTPSetupResponse | null>(null)
    const [qrDataUrl, setQrDataUrl] = useState("")
    const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])

    useEffect(() => {
        if (!setupData?.otpauth_uri) {
            setQrDataUrl("")
            return
        }
        let alive = true
        QRCode.toDataURL(setupData.otpauth_uri, {
            width: 210,
            margin: 2,
            errorCorrectionLevel: "M",
        })
            .then((url) => {
                if (alive) setQrDataUrl(url)
            })
            .catch(() => {
                if (alive) setQrDataUrl("")
            })
        return () => {
            alive = false
        }
    }, [setupData?.otpauth_uri])

    if (!profile) return null

    const handleStartSetup = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (busy) return
        setBusy(true)
        try {
            const res = await setupTOTP(password)
            setSetupData(res)
            setPassword("")
            setCode("")
            setStep("setup")
        } catch (err: any) {
            toast.error("开启绑定失败", { description: err?.message })
        } finally {
            setBusy(false)
        }
    }

    const handleVerifyAndEnable = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (busy || !code.trim()) return
        setBusy(true)
        try {
            const res = await enableTOTP(code.trim())
            setRecoveryCodes(res.recovery_codes || [])
            setSetupData(null)
            setCode("")
            const nextProfile = await getProfile()
            setProfile(nextProfile)
            setStep("recovery")
            toast.success("2FA 六位动态验证码已成功开启！请务必保存好应急恢复码！")
        } catch (err: any) {
            toast.error("验证失败", { description: err?.message })
        } finally {
            setBusy(false)
        }
    }

    const handleDisable = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (busy) return
        setBusy(true)
        try {
            await disableTOTP(password, code.trim())
            setPassword("")
            setCode("")
            const nextProfile = await getProfile()
            setProfile(nextProfile)
            setStep("idle")
            toast.success("已关闭两步验证（2FA）")
        } catch (err: any) {
            toast.error("关闭失败", { description: err?.message })
        } finally {
            setBusy(false)
        }
    }

    const copyRecoveryCodes = async () => {
        try {
            await navigator.clipboard.writeText(recoveryCodes.join("\n"))
            toast.success("已复制全部 8 个应急恢复码，请存进密码管理器！")
        } catch {
            toast.error("复制失败，请手动选中保存")
        }
    }

    const downloadRecoveryCodes = () => {
        const text = [
            `哪吒面板账号 [${profile.username}] 2FA 一次性应急恢复码`,
            `生成时间：${new Date().toLocaleString()}`,
            `每个恢复码仅可使用一次，请妥善保存在 Vaultwarden / 1Password 等密码管理器中：`,
            "",
            ...recoveryCodes,
            "",
        ].join("\n")
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `nezha-2fa-recovery-${profile.username}.txt`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
    }

    return (
        <Card className="w-full border-primary/20">
            <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <ShieldCheck className="h-5 w-5 text-primary" />
                        <span>两步验证（2FA · 6 位动态验证码）</span>
                    </CardTitle>
                    <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            enabled
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        }`}
                    >
                        {enabled ? "🟢 已开启保护" : "⚪ 未开启（建议开启防爆破）"}
                    </span>
                </div>
            </CardHeader>

            <CardContent className="space-y-4 text-xs">
                <p className="leading-relaxed text-muted-foreground">
                    采用国际标准 RFC 6238 TOTP 动态口令（每 30 秒刷新 6 位数字），兼容{" "}
                    <strong>Google Authenticator、Apple 密码、Vaultwarden / Bitwarden、1Password、Microsoft Authenticator</strong>
                    。开启后即使账号密码泄露，攻击者没有你手机里的 6 位动态码也绝对无法登录，且防重放、防爆破（连续输错自动触发 WAF 封 IP）。
                </p>

                {/* 启用后展示一次性应急恢复码 */}
                {step === "recovery" && recoveryCodes.length > 0 && (
                    <div className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
                        <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>2FA 已成功开启！请立刻保存以下 8 个一次性应急恢复码（仅展示这一次）</span>
                        </div>
                        <p className="text-muted-foreground">
                            万一将来换手机或验证器丢失，登录时点「使用应急恢复码」输入其中任意一个即可救急登录（每个用完自动作废）。
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {recoveryCodes.map((rc) => (
                                <code
                                    key={rc}
                                    className="rounded-lg border bg-background px-2.5 py-1.5 text-center font-mono text-xs font-bold tracking-wider"
                                >
                                    {rc}
                                </code>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                            <Button type="button" size="sm" onClick={copyRecoveryCodes} className="gap-1.5">
                                <Copy className="h-3.5 w-3.5" />
                                复制全部恢复码
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={downloadRecoveryCodes}
                                className="gap-1.5"
                            >
                                <Download className="h-3.5 w-3.5" />
                                下载 .txt 保存
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    setRecoveryCodes([])
                                    setStep("idle")
                                }}
                            >
                                我已保存好，关闭提示
                            </Button>
                        </div>
                    </div>
                )}

                {/* 未开启时：第 1 步校验密码生成本地二维码 */}
                {!enabled && step === "idle" && (
                    <form onSubmit={handleStartSetup} className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
                        {!profile.reject_password && !profile.passkey_only && (
                            <div className="flex-1 space-y-1">
                                <Label htmlFor="totp-setup-pwd" className="text-xs font-medium">
                                    输入当前登录密码以生成绑定二维码
                                </Label>
                                <Input
                                    id="totp-setup-pwd"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="请输入当前登录密码"
                                />
                            </div>
                        )}
                        <Button type="submit" disabled={busy} className="gap-1.5">
                            {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <KeyRound className="h-4 w-4" />
                            )}
                            开始绑定 2FA 验证器
                        </Button>
                    </form>
                )}

                {/* 第 2 步：展示离线生成的本地二维码 + 验证 6 位码 */}
                {!enabled && step === "setup" && setupData && (
                    <div className="grid grid-cols-1 gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-12">
                        <div className="flex flex-col items-center justify-center gap-2 sm:col-span-5">
                            {qrDataUrl ? (
                                <img
                                    src={qrDataUrl}
                                    alt="2FA TOTP 二维码"
                                    width={210}
                                    height={210}
                                    className="rounded-lg border bg-white p-1.5 shadow-2xs"
                                />
                            ) : (
                                <div className="flex h-[210px] w-[210px] items-center justify-center rounded-lg border bg-background text-muted-foreground">
                                    生成二维码中...
                                </div>
                            )}
                            <span className="text-[11px] text-muted-foreground">
                                🔒 二维码完全在浏览器本地离线生成
                            </span>
                        </div>

                        <div className="flex flex-col justify-between space-y-3 sm:col-span-7">
                            <div className="space-y-1.5">
                                <p className="font-semibold text-foreground">
                                    第 1 步：用手机验证器扫描左侧二维码（或手动输入下方密钥）
                                </p>
                                <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2">
                                    <code className="flex-1 break-all font-mono text-xs font-bold text-primary">
                                        {setupData.secret}
                                    </code>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={async () => {
                                            await navigator.clipboard.writeText(setupData.secret)
                                            toast.success("已复制 2FA 手动密钥")
                                        }}
                                        className="h-7 shrink-0 gap-1 text-[11px]"
                                    >
                                        <Copy className="h-3 w-3" />
                                        复制密钥
                                    </Button>
                                </div>
                            </div>

                            <form onSubmit={handleVerifyAndEnable} className="space-y-2.5">
                                <div className="space-y-1">
                                    <Label htmlFor="totp-enable-code" className="text-xs font-semibold">
                                        第 2 步：输入验证器里显示的 6 位数字确认启用
                                    </Label>
                                    <p id="totp-enable-hint" className="text-[11px] text-muted-foreground">
                                        只需输入 6 位纯数字，无需空格。
                                    </p>
                                    <Input
                                        id="totp-enable-code"
                                        name="code"
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        enterKeyHint="done"
                                        pattern="\d{6}"
                                        maxLength={6}
                                        aria-describedby="totp-enable-hint"
                                        required
                                        value={code}
                                        onChange={(e) =>
                                            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                                        }
                                        placeholder="000000"
                                        className="min-h-[44px] text-center font-mono text-lg tracking-[0.35em]"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button type="submit" disabled={busy || code.length !== 6} className="gap-1.5">
                                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                        验证并正式开启 2FA
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => {
                                            setSetupData(null)
                                            setCode("")
                                            setStep("idle")
                                        }}
                                    >
                                        取消
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* 已开启时：提供安全关闭入口 */}
                {enabled && step === "idle" && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-2.5">
                        <span className="text-emerald-800 dark:text-emerald-200">
                            ✅ 已启用 2FA：新设备登录需通过 Passkey + 6 位动态验证码（或一次性应急恢复码）；已信任的老设备 180 天内掉登录仅需 Passkey。
                        </span>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                setPassword("")
                                setCode("")
                                setStep("disable")
                            }}
                            className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                            <ShieldOff className="h-3.5 w-3.5" />
                            关闭 2FA
                        </Button>
                    </div>
                )}

                {enabled && step === "disable" && (
                    <form
                        onSubmit={handleDisable}
                        className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
                    >
                        <p className="font-semibold text-destructive">
                            {profile.passkey_only
                                ? "关闭两步验证需要核验你的 6 位动态验证码（或应急恢复码）："
                                : "关闭两步验证需要核验你的当前密码与动态验证码（或应急恢复码）："}
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {!profile.reject_password && !profile.passkey_only && (
                                <div className="space-y-1">
                                    <Label htmlFor="totp-disable-pwd" className="text-xs">
                                        当前登录密码
                                    </Label>
                                    <Input
                                        id="totp-disable-pwd"
                                        name="password"
                                        type="password"
                                        autoComplete="current-password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="输入当前登录密码"
                                    />
                                </div>
                            )}
                            <div className="space-y-1">
                                <Label htmlFor="totp-disable-code" className="text-xs">
                                    6 位动态验证码 / 应急恢复码
                                </Label>
                                <Input
                                    id="totp-disable-code"
                                    name="code"
                                    type="text"
                                    inputMode="text"
                                    autoComplete="one-time-code"
                                    required
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.trim())}
                                    placeholder="如 123456 或 A1B2-C3D4"
                                    className="font-mono"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button type="submit" variant="destructive" size="sm" disabled={busy}>
                                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                确认关闭 2FA
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setStep("idle")}
                            >
                                取消
                            </Button>
                        </div>
                    </form>
                )}
            </CardContent>
        </Card>
    )
}
