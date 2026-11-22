import { FetcherMethod, fetcher } from "./api"

export interface BackupConfigView {
    telegram_auto_enabled: boolean
    schedule_hour: number
    schedule_minute: number
    include_tsdb: boolean
    encrypt_password_masked: string
    has_encrypt_password: boolean
    use_ai_ops_telegram: boolean
    telegram_bot_token_masked: string
    has_telegram_token: boolean
    telegram_endpoint: string
    telegram_chat_id: string
    last_backup_at?: string
    last_backup_status: string
    last_backup_message: string
    last_backup_size_bytes: number
    last_backup_filename: string
    last_backup_encrypted: boolean

    ai_ops_telegram_ready: boolean
    effective_telegram_hint: string
    install_host: string
    listen_port: number
    site_name: string
    version: string
    db_size_bytes: number
    config_size_bytes: number
    tsdb_size_bytes: number
    total_servers: number
    online_servers: number
}

export interface BackupConfigUpdatePayload {
    telegram_auto_enabled: boolean
    schedule_hour: number
    schedule_minute: number
    include_tsdb: boolean
    encrypt_password: string
    use_ai_ops_telegram: boolean
    telegram_bot_token: string
    telegram_endpoint: string
    telegram_chat_id: string
}

export interface AgentMigrateItemResult {
    server_id: number
    server_name: string
    success: boolean
    message: string
}

export interface RestoreBackupResponse {
    restored: boolean
    restarting: boolean
    pre_backup_dir: string
    message: string
}

function readCsrfCookie(): string {
    for (const part of document.cookie.split(";")) {
        const c = part.trim()
        if (c.startsWith("nz-csrf=")) {
            return c.slice("nz-csrf=".length)
        }
    }
    return ""
}

export function getBackupConfig() {
    return fetcher<BackupConfigView>(FetcherMethod.GET, "/api/v1/backup/config")
}

export function updateBackupConfig(payload: BackupConfigUpdatePayload) {
    return fetcher<BackupConfigView>(FetcherMethod.PUT, "/api/v1/backup/config", payload)
}

export function triggerTelegramBackupNow() {
    return fetcher<BackupConfigView>(FetcherMethod.POST, "/api/v1/backup/telegram-now")
}

export function batchMigrateAgents(payload: {
    server_ids: number[]
    new_server: string
    use_tls: boolean
}) {
    return fetcher<{ results: AgentMigrateItemResult[] }>(
        FetcherMethod.POST,
        "/api/v1/backup/migrate-agents",
        payload,
    )
}

export async function exportBackupArchive(payload: {
    include_tsdb: boolean
    encrypt_password: string
    use_saved_password: boolean
}): Promise<{ filename: string; size: number }> {
    const csrf = readCsrfCookie()
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    }
    if (csrf) {
        headers["X-CSRF-Token"] = csrf
    }
    const resp = await fetch("/api/v1/backup/export", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    })
    if (!resp.ok) {
        throw new Error(`下载失败 (${resp.status})`)
    }
    const ct = resp.headers.get("Content-Type") || ""
    if (ct.includes("application/json")) {
        const json = await resp.json()
        if (!json.success) {
            throw new Error(json.error || "导出备份失败")
        }
    }
    const blob = await resp.blob()
    const headerName = resp.headers.get("X-Backup-Filename")
    const filename = headerName || `nezha-backup-${Date.now()}.tar.gz`

    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)

    return { filename, size: blob.size }
}

export async function restoreBackupArchive(
    file: File,
    password: string,
): Promise<RestoreBackupResponse> {
    const csrf = readCsrfCookie()
    const headers: Record<string, string> = {}
    if (csrf) {
        headers["X-CSRF-Token"] = csrf
    }
    const fd = new FormData()
    fd.append("file", file)
    if (password.trim()) {
        fd.append("password", password.trim())
    }
    const resp = await fetch("/api/v1/backup/restore", {
        method: "POST",
        headers,
        body: fd,
    })
    if (!resp.ok) {
        throw new Error(`上传还原失败 (${resp.status})`)
    }
    const json = await resp.json()
    if (!json.success) {
        throw new Error(json.error || "还原失败")
    }
    return json.data as RestoreBackupResponse
}

export function formatBytes(n?: number): string {
    if (!n || n <= 0) return "0 B"
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${n} B`
}
