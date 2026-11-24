import Login from "@/routes/login"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    login: vi.fn(),
    completePasskeyAuth: vi.fn(),
    getAuthPolicy: vi.fn(),
    beginPasskeyLogin: vi.fn(),
    finishPasskeyLoginRaw: vi.fn(),
    completePasskeyLoginTOTP: vi.fn(),
    signalUnknownCredentialSafe: vi.fn(),
}))

vi.mock("@/hooks/useAuth", () => ({
    useAuth: () => ({
        login: mocks.login,
        completePasskeyAuth: mocks.completePasskeyAuth,
        loginOauth2: vi.fn(),
        logout: vi.fn(),
        profile: undefined,
        loading: false,
    }),
}))

vi.mock("@/api/passkey", () => ({
    getAuthPolicy: mocks.getAuthPolicy,
    beginPasskeyLogin: mocks.beginPasskeyLogin,
    finishPasskeyLoginRaw: mocks.finishPasskeyLoginRaw,
    completePasskeyLoginTOTP: mocks.completePasskeyLoginTOTP,
    signalUnknownCredentialSafe: mocks.signalUnknownCredentialSafe,
}))

beforeEach(() => {
    mocks.getAuthPolicy.mockResolvedValue({
        single_admin: true,
        passkey_available: false,
        passkey_only: false,
        password_login_enabled: true,
        oauth2_enabled: false,
        emergency_password_override: false,
        rp_id: "nzzz.yp.fyi",
    })
})

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe("Login Passkey + 2FA flows", () => {
    it("hides password form and OAuth2 completely in passkey-only mode", async () => {
        mocks.getAuthPolicy.mockResolvedValueOnce({
            single_admin: true,
            passkey_available: true,
            passkey_only: true,
            password_login_enabled: false,
            oauth2_enabled: false,
            emergency_password_override: false,
            rp_id: "nzzz.yp.fyi",
        })

        render(
            <MemoryRouter>
                <Login />
            </MemoryRouter>,
        )

        expect(await screen.findByText("管理员 Passkey 登录")).toBeTruthy()
        expect(screen.getByRole("button", { name: /使用 Passkey 登录/ })).toBeTruthy()
        expect(screen.queryByPlaceholderText("admin")).toBeNull()
        expect(screen.queryByText("OAuth2")).toBeNull()
    })

    it("prompts for 6-digit 2FA on new-device Passkey login and skips 2FA on trusted old device", async () => {
        mocks.getAuthPolicy.mockResolvedValue({
            single_admin: true,
            passkey_available: true,
            passkey_only: true,
            password_login_enabled: false,
            oauth2_enabled: false,
            emergency_password_override: false,
            rp_id: "nzzz.yp.fyi",
        })
        mocks.beginPasskeyLogin.mockResolvedValue({
            challenge_id: "ch-1",
            rp_id: "nzzz.yp.fyi",
            publicKey: { challenge: "YWJjZGVm", rpId: "nzzz.yp.fyi", allowCredentials: [] },
        })
        mocks.finishPasskeyLoginRaw
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                data: {
                    ok: false,
                    trusted_device: false,
                    totp_required: true,
                    pending_token: "pt-new-device",
                    username: "JJJJMuyuan",
                },
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                data: {
                    ok: true,
                    trusted_device: true,
                    totp_required: false,
                    username: "JJJJMuyuan",
                },
            })
        mocks.completePasskeyLoginTOTP.mockResolvedValueOnce({
            ok: true,
            trusted_device: true,
            totp_required: false,
        })

        Object.defineProperty(window, "PublicKeyCredential", {
            configurable: true,
            value: {
                parseRequestOptionsFromJSON: (opts: any) => opts,
                getClientCapabilities: async () => ({ conditionalGet: false }),
            },
        })
        Object.defineProperty(navigator, "credentials", {
            configurable: true,
            value: {
                get: vi.fn().mockResolvedValue({
                    toJSON: () => ({ id: "dGVzdC1jcmVkLTE", type: "public-key", response: {} }),
                }),
            },
        })

        render(
            <MemoryRouter>
                <Login />
            </MemoryRouter>,
        )

        // 1. New device -> requires 6-digit 2FA after Passkey
        const pkBtn = await screen.findByRole("button", { name: /使用 Passkey 登录/ })
        fireEvent.click(pkBtn)

        const totpInput = (await screen.findByLabelText("6 位动态验证码")) as HTMLInputElement
        expect(screen.getByText("新设备二次验证（2FA）")).toBeTruthy()
        expect(totpInput.getAttribute("autocomplete")).toBe("one-time-code")

        fireEvent.change(totpInput, { target: { value: "654321" } })
        fireEvent.submit(totpInput.closest("form")!)

        await waitFor(() => {
            expect(mocks.completePasskeyLoginTOTP).toHaveBeenCalledWith("pt-new-device", "654321")
            expect(mocks.completePasskeyAuth).toHaveBeenCalledTimes(1)
        })

        // 2. Old trusted device -> completes immediately with Passkey only (no 2FA screen)
        cleanup()
        render(
            <MemoryRouter>
                <Login />
            </MemoryRouter>,
        )
        const pkBtnOld = await screen.findByRole("button", { name: /使用 Passkey 登录/ })
        fireEvent.click(pkBtnOld)

        await waitFor(() => {
            expect(mocks.completePasskeyAuth).toHaveBeenCalledTimes(2)
        })
        expect(screen.queryByLabelText("6 位动态验证码")).toBeNull()
    })

    it("still supports initial password + 2FA flow before passkey-only lock is turned on", async () => {
        mocks.login.mockResolvedValueOnce("totp_required").mockResolvedValueOnce("ok")

        render(
            <MemoryRouter>
                <Login />
            </MemoryRouter>,
        )

        const [usernameInput, passwordInput] = await screen.findAllByPlaceholderText("admin")
        expect(usernameInput.getAttribute("autocomplete")).toBe("username webauthn")

        fireEvent.change(usernameInput, { target: { value: "admin" } })
        fireEvent.change(passwordInput, { target: { value: "MyPass123!" } })
        fireEvent.submit(usernameInput.closest("form")!)

        const totpInput = (await screen.findByLabelText("6 位动态验证码")) as HTMLInputElement
        fireEvent.change(totpInput, { target: { value: "287082" } })
        fireEvent.submit(totpInput.closest("form")!)

        await waitFor(() => {
            expect(mocks.login).toHaveBeenNthCalledWith(2, "admin", "MyPass123!", "287082")
        })
    })
})
