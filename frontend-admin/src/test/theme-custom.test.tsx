import ThemeCustomPage from "@/routes/theme-custom"
import { DEFAULT_THEME_CONFIG } from "@/types"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

vi.mock("sonner", () => ({
    toast: Object.assign(vi.fn(), {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    }),
}))

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
        i18n: { language: "zh-CN", changeLanguage: vi.fn() },
    }),
    initReactI18next: { type: "3rdParty", init: () => undefined },
    Trans: ({ children }: { children?: React.ReactNode }) => children ?? null,
}))

const authState = vi.hoisted(() => ({
    profile: { id: 1, role: 0 } as { id: number; role: number } | undefined,
    loading: false,
}))
vi.mock("@/hooks/useAuth", () => ({
    useAuth: () => authState,
}))
vi.mock("@/hooks/useNotfication", () => ({
    useNotification: () => ({ notifierGroup: [] }),
}))

const settings = vi.hoisted(() => ({
    data: {
        config: {
            site_name: "My Nezha",
            language: "zh-CN",
            user_template: "user-dist",
            cover: 0,
            ip_change_notification_group_id: 2,
            dashboard_host: "panel.example.com",
            online_stats_days: 30,
            theme_config: undefined as typeof DEFAULT_THEME_CONFIG | undefined,
        },
        frontend_templates: [{ path: "user-dist", is_admin: false, name: "Default" }],
    },
    mutate: vi.fn(),
    update: vi.fn(),
}))

vi.mock("@/hooks/useSetting", () => ({
    default: () => ({ data: settings.data, mutate: settings.mutate }),
}))
vi.mock("@/api/settings", () => ({
    updateSettings: (...args: unknown[]) => settings.update(...args),
}))

beforeEach(() => {
    authState.profile = { id: 1, role: 0 }
    authState.loading = false
    settings.update.mockReset().mockResolvedValue(undefined)
    settings.mutate.mockReset().mockResolvedValue(undefined)
    settings.data.config.cover = 0
    settings.data.config.online_stats_days = 30
    settings.data.config.theme_config = undefined
})

afterEach(cleanup)

test("renders theme studio, preserves existing backend settings including cover=0, and submits theme_config", async () => {
    await act(async () => {
        render(
            <MemoryRouter initialEntries={["/dashboard/settings/theme-custom"]}>
                <ThemeCustomPage />
            </MemoryRouter>,
        )
    })

    // Click "全部关闭" (Disable All) to toggle all feature modules off
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "全部关闭" }))
    })

    // Save changes
    const saveButtons = screen.getAllByRole("button", { name: "Confirm" })
    await act(async () => {
        fireEvent.click(saveButtons[0])
    })

    await waitFor(() => expect(settings.update).toHaveBeenCalledTimes(1))
    const payload = settings.update.mock.calls[0][0]
    expect(payload.cover).toBe(0)
    expect(payload.online_stats_days).toBe(30)
    expect(payload.user_template).toBe("user-dist")
    expect(payload.theme_config.traffic_bar.enabled).toBe(false)
    expect(payload.theme_config.earth_globe.enabled).toBe(false)
    expect(payload.theme_config.dock.enabled).toBe(false)
})

test("redirects non-admin users away from theme studio", async () => {
    authState.profile = { id: 2, role: 1 }

    await act(async () => {
        render(
            <MemoryRouter initialEntries={["/dashboard/settings/theme-custom"]}>
                <Routes>
                    <Route path="/dashboard/settings/theme-custom" element={<ThemeCustomPage />} />
                    <Route path="/dashboard/settings/api-tokens" element={<div>API Tokens Page</div>} />
                </Routes>
            </MemoryRouter>,
        )
    })

    expect(screen.getByText("API Tokens Page")).toBeTruthy()
})
