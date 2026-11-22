import { LLM_PROVIDER_PRESETS, parseToolSteps, postAIOpsChat } from "@/api/ai-ops"
import AIOpsPage from "@/routes/ai-ops"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

const authState = vi.hoisted(() => ({
    loading: false,
    profile: { id: 1, username: "admin", role: 0 } as
        | { id: number; username: string; role: number }
        | undefined,
}))

vi.mock("@/hooks/useAuth", () => ({
    useAuth: () => authState,
}))

vi.mock("@/hooks/useNotfication", () => ({
    useNotification: () => ({ notifierGroup: [] }),
}))

vi.mock("swr", () => ({
    default: (key: string | null) => {
        if (key === "/api/v1/ai-ops/config") {
            return {
                data: {
                    enabled: true,
                    small_base_url: "https://api.deepseek.com/v1",
                    small_api_key_masked: "sk-1••••••••9999",
                    has_small_key: true,
                    small_model: "deepseek-chat",
                    share_provider: true,
                    large_base_url: "",
                    large_api_key_masked: "",
                    has_large_key: false,
                    large_model: "deepseek-reasoner",
                    patrol_interval_min: 3,
                    cpu_threshold: 88,
                    mem_threshold: 90,
                    disk_threshold: 88,
                    cooldown_min: 60,
                    auto_self_heal: false,
                    notification_group_id: 0,
                    telegram_enabled: false,
                    telegram_bot_token_masked: "",
                    has_telegram_token: false,
                    telegram_endpoint: "https://api.telegram.org",
                    telegram_allowed_chat_ids: "",
                },
                mutate: vi.fn(),
            }
        }
        return { data: [], mutate: vi.fn() }
    },
}))

vi.mock("@/api/ai-ops", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/api/ai-ops")>()
    return {
        ...actual,
        postAIOpsChat: vi.fn().mockResolvedValue({ session_id: 7, message_id: 12 }),
    }
})

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe("AIOpsPage & helpers", () => {
    it("redirects non-admin members away from /dashboard/ai-ops", () => {
        authState.profile = { id: 2, username: "member", role: 1 }
        render(
            <MemoryRouter initialEntries={["/dashboard/ai-ops"]}>
                <Routes>
                    <Route path="/dashboard/ai-ops" element={<AIOpsPage />} />
                    <Route path="/dashboard" element={<div>dashboard home</div>} />
                </Routes>
            </MemoryRouter>,
        )
        expect(screen.getByText("dashboard home")).toBeTruthy()
    })

    it("guards Enter submission during IME composition (isComposing / keyCode 229) and submits on plain Enter", async () => {
        authState.profile = { id: 1, username: "admin", role: 0 }
        // Polyfill scrollIntoView in jsdom
        window.HTMLElement.prototype.scrollIntoView = vi.fn()

        render(
            <MemoryRouter initialEntries={["/dashboard/ai-ops"]}>
                <AIOpsPage />
            </MemoryRouter>,
        )

        const textarea = screen.getByLabelText("输入运维指令") as HTMLTextAreaElement
        fireEvent.change(textarea, { target: { value: "帮我升级香港小鸡的 caddy 容器" } })

        // Simulate IME confirmation Enter (keyCode 229): must NOT submit
        fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 })
        expect(postAIOpsChat).not.toHaveBeenCalled()

        // Simulate plain Enter: MUST submit
        fireEvent.keyDown(textarea, { key: "Enter", keyCode: 13 })
        await waitFor(() => {
            expect(postAIOpsChat).toHaveBeenCalledWith({
                session_id: 0,
                prompt: "帮我升级香港小鸡的 caddy 容器",
            })
        })
    })

    it("parses tool steps safely and provides Dual-Model presets", () => {
        expect(LLM_PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(5)
        expect(parseToolSteps('[{"tool":"exec_on_server","duration_ms":42}]')).toHaveLength(1)
        expect(parseToolSteps("not-json")).toEqual([])
    })
})
