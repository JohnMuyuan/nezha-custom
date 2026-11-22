import Login from "@/routes/login"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

const mockLogin = vi.hoisted(() => vi.fn())

vi.mock("@/hooks/useAuth", () => ({
    useAuth: () => ({
        login: mockLogin,
        loginOauth2: vi.fn(),
        logout: vi.fn(),
        profile: undefined,
        loading: false,
    }),
}))

vi.mock("@/hooks/useSetting", () => ({
    default: () => ({ data: { config: { oauth2_providers: [] } } }),
}))

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe("Login 2FA (6-digit TOTP) flow", () => {
    it("transitions to single numeric one-time-code input when server returns totp_required and submits 6-digit code", async () => {
        mockLogin.mockResolvedValueOnce("totp_required").mockResolvedValueOnce("ok")

        render(
            <MemoryRouter>
                <Login />
            </MemoryRouter>,
        )

        const [usernameInput, passwordInput] = screen.getAllByPlaceholderText("admin")

        fireEvent.change(usernameInput, { target: { value: "admin" } })
        fireEvent.change(passwordInput, { target: { value: "MyPass123!" } })
        fireEvent.submit(usernameInput.closest("form")!)

        const totpInput = (await screen.findByLabelText("6 位动态验证码")) as HTMLInputElement
        expect(totpInput.type).toBe("text")
        expect(totpInput.getAttribute("inputmode")).toBe("numeric")
        expect(totpInput.getAttribute("autocomplete")).toBe("one-time-code")
        expect(totpInput.getAttribute("maxlength")).toBe("6")

        fireEvent.change(totpInput, { target: { value: "287082" } })
        fireEvent.submit(totpInput.closest("form")!)

        await waitFor(() => {
            expect(mockLogin).toHaveBeenNthCalledWith(2, "admin", "MyPass123!", "287082")
        })
    })
})
