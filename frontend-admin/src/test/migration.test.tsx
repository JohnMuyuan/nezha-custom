import { triggerTelegramBackupNow, updateBackupConfig } from "@/api/backup"
import MigrationPage from "@/routes/migration"
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

vi.mock("@/api/backup", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/api/backup")>()
    return {
        ...actual,
        updateBackupConfig: vi.fn().mockResolvedValue(undefined),
        triggerTelegramBackupNow: vi.fn().mockResolvedValue(undefined),
    }
})

vi.mock("swr", () => ({
    default: (key: string | null) => {
        if (key === "/api/v1/backup/config") {
            return {
                data: {
                    telegram_auto_enabled: true,
                    schedule_hour: 3,
                    schedule_minute: 15,
                    include_tsdb: false,
                    encrypt_password_masked: "MyPa••••••••2026",
                    has_encrypt_password: true,
                    use_ai_ops_telegram: true,
                    telegram_bot_token_masked: "",
                    has_telegram_token: false,
                    telegram_endpoint: "https://api.telegram.org",
                    telegram_chat_id: "",
                    last_backup_status: "ok",
                    last_backup_message: "已成功发送 nezha-backup.tar.gz.enc",
                    last_backup_size_bytes: 820000,
                    last_backup_filename: "nezha-backup.tar.gz.enc",
                    last_backup_encrypted: true,
                    ai_ops_telegram_ready: true,
                    effective_telegram_hint: "复用 AI 运维机器人（接收 Chat ID: 5279033136）",
                    install_host: "nzzz.yp.fyi:20070",
                    listen_port: 20070,
                    site_name: "江某人的鸡鸡们",
                    version: "v2.7.0-custom.16",
                    db_size_bytes: 2_500_000,
                    config_size_bytes: 3800,
                    tsdb_size_bytes: 12_000_000,
                    total_servers: 10,
                    online_servers: 9,
                },
                mutate: vi.fn(),
            }
        }
        if (key === "/api/v1/server") {
            return { data: [], mutate: vi.fn() }
        }
        return { data: undefined, mutate: vi.fn() }
    },
}))

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe("MigrationPage (Backup & One-Click Migration)", () => {
    it("redirects non-admin members away from /dashboard/migration", () => {
        authState.profile = { id: 2, username: "member", role: 1 }
        render(
            <MemoryRouter initialEntries={["/dashboard/migration"]}>
                <Routes>
                    <Route path="/dashboard/migration" element={<MigrationPage />} />
                    <Route path="/dashboard" element={<div>dashboard home</div>} />
                </Routes>
            </MemoryRouter>,
        )
        expect(screen.getByText("dashboard home")).toBeTruthy()
    })

    it("renders live stats, saves config with include_tsdb=false default, and triggers Telegram backup", async () => {
        authState.profile = { id: 1, username: "admin", role: 0 }
        render(
            <MemoryRouter initialEntries={["/dashboard/migration"]}>
                <MigrationPage />
            </MemoryRouter>,
        )

        expect(screen.getByText("nzzz.yp.fyi:20070")).toBeTruthy()
        expect(screen.getByText("9 / 10 台")).toBeTruthy()

        fireEvent.click(screen.getByRole("button", { name: /保存备份设置/ }))
        await waitFor(() => {
            expect(updateBackupConfig).toHaveBeenCalledWith(
                expect.objectContaining({
                    telegram_auto_enabled: true,
                    include_tsdb: false,
                    use_ai_ops_telegram: true,
                }),
            )
        })

        fireEvent.click(screen.getByRole("button", { name: /立即发一份到 Telegram/ }))
        await waitFor(() => {
            expect(triggerTelegramBackupNow).toHaveBeenCalledTimes(1)
        })
    })

    it("opens native <dialog> confirmation modal when restoring a selected archive", () => {
        authState.profile = { id: 1, username: "admin", role: 0 }
        const showModalSpy = vi.fn()
        HTMLDialogElement.prototype.showModal = showModalSpy

        render(
            <MemoryRouter initialEntries={["/dashboard/migration"]}>
                <MigrationPage />
            </MemoryRouter>,
        )

        const fileInput = screen.getByLabelText(/选择备份文件/) as HTMLInputElement
        const fakeFile = new File(["fake-tar"], "nezha-backup-test.tar.gz.enc", {
            type: "application/octet-stream",
        })
        fireEvent.change(fileInput, { target: { files: [fakeFile] } })

        const restoreBtn = screen.getByRole("button", { name: /校验并覆盖还原数据/ })
        fireEvent.click(restoreBtn)

        expect(showModalSpy).toHaveBeenCalledTimes(1)
    })
})
