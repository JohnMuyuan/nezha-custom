import { FetcherMethod, fetcher } from "./api"

export interface AIOpsConfigView {
    enabled: boolean
    small_base_url: string
    small_api_key_masked: string
    has_small_key: boolean
    small_model: string
    share_provider: boolean
    large_base_url: string
    large_api_key_masked: string
    has_large_key: boolean
    large_model: string
    patrol_interval_min: number
    cpu_threshold: number
    mem_threshold: number
    disk_threshold: number
    cooldown_min: number
    auto_self_heal: boolean
    notification_group_id: number
    telegram_enabled: boolean
    telegram_bot_token_masked: string
    has_telegram_token: boolean
    telegram_endpoint: string
    telegram_allowed_chat_ids: string
}

export interface AIOpsConfigUpdatePayload {
    enabled: boolean
    small_base_url: string
    small_api_key: string
    small_model: string
    share_provider: boolean
    large_base_url: string
    large_api_key: string
    large_model: string
    patrol_interval_min: number
    cpu_threshold: number
    mem_threshold: number
    disk_threshold: number
    cooldown_min: number
    auto_self_heal: boolean
    notification_group_id: number
    telegram_enabled: boolean
    telegram_bot_token: string
    telegram_endpoint: string
    telegram_allowed_chat_ids: string
}

export interface AIOpsToolStep {
    tool: string
    server_id?: number
    server_name?: string
    command?: string
    summary?: string
    output?: string
    duration_ms: number
    is_error?: boolean
}

export interface AIOpsChatSession {
    id: number
    created_at: string
    updated_at: string
    title: string
    source: string
}

export interface AIOpsChatMessage {
    id: number
    created_at: string
    session_id: number
    role: "user" | "assistant"
    content: string
    model_used?: string
    status: "done" | "running" | "error" | "cancelled"
    tool_steps_json?: string
}

export interface AIOpsSessionDetail {
    session: AIOpsChatSession
    messages: AIOpsChatMessage[]
}

export interface AIOpsIncident {
    id: number
    created_at: string
    updated_at: string
    server_id: number
    server_name: string
    trigger_type: string
    trigger_summary: string
    status: "triaging" | "dismissed_by_small" | "diagnosing" | "reported" | "healed" | "error"
    severity: "low" | "medium" | "high"
    small_verdict: string
    large_report: string
    tool_steps_json: string
}

export interface LLMProviderPreset {
    id: string
    label: string
    badge: string
    baseUrl: string
    smallModel: string
    largeModel: string
    hint: string
}

export const LLM_PROVIDER_PRESETS: LLMProviderPreset[] = [
    {
        id: "deepseek",
        label: "DeepSeek 官方",
        badge: "性价比高",
        baseUrl: "https://api.deepseek.com/v1",
        smallModel: "deepseek-chat",
        largeModel: "deepseek-reasoner",
        hint: "推荐组合：V3 负责秒级初筛，R1 负责复杂故障推理与自动化容器运维",
    },
    {
        id: "siliconflow",
        label: "硅基流动 SiliconFlow",
        badge: "小模型极省",
        baseUrl: "https://api.siliconflow.cn/v1",
        smallModel: "Qwen/Qwen2.5-7B-Instruct",
        largeModel: "deepseek-ai/DeepSeek-V3",
        hint: "7B 小模型有免费额度，用来 24 小时初筛几乎 0 成本！",
    },
    {
        id: "openrouter",
        label: "OpenRouter 聚合",
        badge: "海外全模型",
        baseUrl: "https://openrouter.ai/api/v1",
        smallModel: "google/gemini-2.5-flash-lite",
        largeModel: "anthropic/claude-sonnet-4",
        hint: "一个 Key 同时调用 Flash-Lite 看门 + Claude Sonnet 排障运维",
    },
    {
        id: "gemini",
        label: "Google Gemini",
        badge: "官方兼容",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        smallModel: "gemini-2.5-flash-lite",
        largeModel: "gemini-2.5-pro",
        hint: "使用 Google AI Studio API Key，自带免费额度",
    },
    {
        id: "dashscope",
        label: "通义千问 (阿里云)",
        badge: "国内直连",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        smallModel: "qwen-turbo",
        largeModel: "qwen-plus",
        hint: "阿里云百炼 API Key，国内与海外网络均可稳定访问",
    },
    {
        id: "custom",
        label: "OpenAI / 任意中转站",
        badge: "NewAPI",
        baseUrl: "https://api.openai.com/v1",
        smallModel: "gpt-4o-mini",
        largeModel: "gpt-4.1",
        hint: "支持任意兼容 OpenAI /v1/chat/completions 格式的自建或第三方中转站",
    },
]

export function getAIOpsConfig() {
    return fetcher<AIOpsConfigView>(FetcherMethod.GET, "/api/v1/ai-ops/config")
}

export function updateAIOpsConfig(payload: AIOpsConfigUpdatePayload) {
    return fetcher<AIOpsConfigView>(FetcherMethod.PUT, "/api/v1/ai-ops/config", payload)
}

export function testAIOpsModel(payload: {
    tier: "small" | "large"
    base_url: string
    api_key: string
    model: string
    share_provider: boolean
}) {
    return fetcher<{ reply: string; latency_ms: number }>(
        FetcherMethod.POST,
        "/api/v1/ai-ops/test-model",
        payload,
    )
}

export function postAIOpsChat(payload: { session_id: number; prompt: string }) {
    return fetcher<{ session_id: number; message_id: number }>(
        FetcherMethod.POST,
        "/api/v1/ai-ops/chat",
        payload,
    )
}

export function cancelAIOpsSession(sessionId: number) {
    return fetcher<{ cancelled: boolean }>(
        FetcherMethod.POST,
        `/api/v1/ai-ops/sessions/${sessionId}/cancel`,
    )
}

export function deleteAIOpsSession(sessionId: number) {
    return fetcher<{ deleted: number }>(
        FetcherMethod.DELETE,
        `/api/v1/ai-ops/sessions/${sessionId}`,
    )
}

export function triggerAIOpsPatrolNow() {
    return fetcher<{ started: boolean }>(FetcherMethod.POST, "/api/v1/ai-ops/patrol-now")
}

export function clearAIOpsIncidents() {
    return fetcher<{ cleared: boolean }>(FetcherMethod.DELETE, "/api/v1/ai-ops/incidents")
}

export function parseToolSteps(raw?: string): AIOpsToolStep[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}
