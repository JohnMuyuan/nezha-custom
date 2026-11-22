import { Oauth2RequestType, getOauth2RedirectURL } from "@/api/oauth2"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { OAuthProviderIcon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useAuth } from "@/hooks/useAuth"
import useSetting from "@/hooks/useSetting"
import { zodResolver } from "@hookform/resolvers/zod"
import i18next from "i18next"
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react"
import React, { useEffect, useRef, useState } from "react"
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

function Login() {
    const { login, loginOauth2 } = useAuth()
    const { data: settingData } = useSetting()
    const { t } = useTranslation()

    const [showPassword, setShowPassword] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    // Step 2: 2FA TOTP verification state
    const [pendingCreds, setPendingCreds] = useState<{
        username: string
        password: string
    } | null>(null)
    const [totpCode, setTotpCode] = useState("")
    const [useRecoveryCode, setUseRecoveryCode] = useState(false)
    const totpInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const oauth2 = new URLSearchParams(window.location.search).get("oauth2")
        if (oauth2) {
            loginOauth2()
        }
    }, [loginOauth2])

    useEffect(() => {
        if (pendingCreds) {
            totpInputRef.current?.focus()
        }
    }, [pendingCreds, useRecoveryCode])

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            username: "",
            password: "",
        },
    })

    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (submitting) return
        setSubmitting(true)
        try {
            const res = await login(values.username, values.password)
            if (res === "totp_required") {
                setPendingCreds({ username: values.username, password: values.password })
                setTotpCode("")
                setUseRecoveryCode(false)
            }
        } finally {
            setSubmitting(false)
        }
    }

    async function onSubmitTOTP(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!pendingCreds || submitting) return
        const cleaned = totpCode.trim()
        if (!cleaned) return
        setSubmitting(true)
        try {
            const res = await login(pendingCreds.username, pendingCreds.password, cleaned)
            if (res === "totp_invalid") {
                setTotpCode("")
                totpInputRef.current?.focus()
            }
        } finally {
            setSubmitting(false)
        }
    }

    async function loginWith(provider: string) {
        try {
            const redirectUrl = await getOauth2RedirectURL(provider, Oauth2RequestType.LOGIN)
            window.location.assign(redirectUrl.redirect!)
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    if (pendingCreds) {
        return (
            <div className="m-auto mt-24 max-w-xs sm:max-w-sm">
                <div className="rounded-xl border bg-card p-6 shadow-xs">
                    <div className="mb-4 flex items-center gap-2.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                            <h1 className="text-base font-bold">两步验证（2FA）</h1>
                            <p className="text-xs text-muted-foreground">
                                正在登录账号：<strong>{pendingCreds.username}</strong>
                            </p>
                        </div>
                    </div>

                    <form onSubmit={onSubmitTOTP} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="login-totp-input" className="text-xs font-semibold">
                                {useRecoveryCode ? "8 位应急恢复码" : "6 位动态验证码"}
                            </Label>
                            {/* Place instructional hint above the input so autofill popovers and mobile keyboards do not obscure it */}
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
                                    setPendingCreds(null)
                                    setTotpCode("")
                                }}
                                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            >
                                <ArrowLeft className="h-3.5 w-3.5" />
                                返回修改账号密码
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

    return (
        <div className="m-auto mt-28 max-w-xs sm:max-w-sm">
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        enterKeyHint="next"
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
                                            enterKeyHint="done"
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
                        {t("Login")}
                    </Button>
                </form>
                {settingData?.config?.oauth2_providers &&
                    settingData?.config?.oauth2_providers.length > 0 && (
                        <section className="my-3 flex w-full items-center">
                            <Separator className="flex-1" />
                            <div className="flex w-full max-w-[100px] justify-center text-xs text-muted-foreground">
                                OAuth2
                            </div>
                            <Separator className="flex-1" />
                        </section>
                    )}
            </Form>
            <div className="mt-3 flex flex-col gap-3">
                {settingData?.config?.oauth2_providers?.map((p: string) => (
                    <Button
                        key={p}
                        type="button"
                        className="w-full rounded-lg bg-muted text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-muted/80 hover:text-primary/80"
                        onClick={() => loginWith(p)}
                    >
                        <OAuthProviderIcon provider={p} className="size-4" />
                        {p}
                    </Button>
                ))}
            </div>
        </div>
    )
}

export default Login
