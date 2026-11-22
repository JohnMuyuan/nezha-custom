package model

import (
	"strings"
	"time"
)

// AIOpsConfig stores the singleton AI Ops configuration in SQLite (ID = 1).
// Stored in DB rather than ConfigForGuests so API keys and Bot tokens are NEVER
// exposed to unauthenticated guests or non-admin users.
type AIOpsConfig struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement:false" json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	Enabled bool `json:"enabled"`

	// 低级模型（值班班长：定时巡检与异常初筛）
	SmallBaseURL string `json:"small_base_url"`
	SmallAPIKey  string `json:"-"`
	SmallModel   string `json:"small_model"`

	// 高级模型（主治医生 & 运维管家：深度排障与对话执行）
	ShareProvider bool   `json:"share_provider"` // 与低级模型共用 BaseURL 和 APIKey
	LargeBaseURL  string `json:"large_base_url"`
	LargeAPIKey   string `json:"-"`
	LargeModel    string `json:"large_model"`

	// 本地零成本哨兵与巡检参数
	PatrolIntervalMin   int     `json:"patrol_interval_min"`   // 哨兵扫描间隔（分钟，默认 3）
	CPUThreshold        float64 `json:"cpu_threshold"`         // CPU 告警阈值 %（默认 88）
	MemThreshold        float64 `json:"mem_threshold"`         // 内存告警阈值 %（默认 90）
	DiskThreshold       float64 `json:"disk_threshold"`        // 硬盘告警阈值 %（默认 88）
	CooldownMin         int     `json:"cooldown_min"`          // 同机同类异常冷却分钟（默认 60）
	AutoSelfHeal        bool    `json:"auto_self_heal"`        // 后台无人巡检时是否允许自动修复操作（默认 false=仅只读诊断）
	NotificationGroupID uint64  `json:"notification_group_id"` // 诊断报告推送的通知分组 ID（0=不推通知组）

	// Telegram 双向机器人联动
	TelegramEnabled        bool   `json:"telegram_enabled"`
	TelegramBotToken       string `json:"-"`
	TelegramEndpoint       string `json:"telegram_endpoint"`
	TelegramAllowedChatIDs string `json:"telegram_allowed_chat_ids"` // 逗号分隔的管理员 Chat ID 白名单

	// AI 安全入侵与防攻击哨兵（SSH 陌生登录 / 后门篡改 / 数据外泄 / CC 与连接洪泛）
	SecurityBootstrapped     bool    `json:"-"`
	SecurityAutoBootstrapped bool    `json:"-"`
	SecurityEnabled          bool    `json:"security_enabled"`
	SecurityAutoRespond      bool    `json:"security_auto_respond"` // 高危入侵/攻击时是否先斩后奏自动应急反制（踢会话/封IP/杀木马）
	SecurityIntervalMin      int     `json:"security_interval_min"` // SSH 与文件哈希轻量巡检间隔（分钟，默认 2）
	TrustedSSHIPS            string  `json:"trusted_ssh_ips"`       // 信任的管理员 SSH 登录 IP / CIDR 白名单
	OutboundSpikeMbps        float64 `json:"outbound_spike_mbps"`   // 疑似数据外泄持续上传网速阈值（Mbps，默认 50）
	ConnSpikeThreshold       uint64  `json:"conn_spike_threshold"`  // 疑似网站被攻击 TCP+UDP 连接数阈值（默认 1200）
}

// AIOpsConfigView is the admin-facing DTO with masked secrets.
type AIOpsConfigView struct {
	Enabled                bool    `json:"enabled"`
	SmallBaseURL           string  `json:"small_base_url"`
	SmallAPIKeyMasked      string  `json:"small_api_key_masked"`
	HasSmallKey            bool    `json:"has_small_key"`
	SmallModel             string  `json:"small_model"`
	ShareProvider          bool    `json:"share_provider"`
	LargeBaseURL           string  `json:"large_base_url"`
	LargeAPIKeyMasked      string  `json:"large_api_key_masked"`
	HasLargeKey            bool    `json:"has_large_key"`
	LargeModel             string  `json:"large_model"`
	PatrolIntervalMin      int     `json:"patrol_interval_min"`
	CPUThreshold           float64 `json:"cpu_threshold"`
	MemThreshold           float64 `json:"mem_threshold"`
	DiskThreshold          float64 `json:"disk_threshold"`
	CooldownMin            int     `json:"cooldown_min"`
	AutoSelfHeal           bool    `json:"auto_self_heal"`
	NotificationGroupID    uint64  `json:"notification_group_id"`
	TelegramEnabled        bool    `json:"telegram_enabled"`
	TelegramBotTokenMasked string  `json:"telegram_bot_token_masked"`
	HasTelegramToken       bool    `json:"has_telegram_token"`
	TelegramEndpoint       string  `json:"telegram_endpoint"`
	TelegramAllowedChatIDs string  `json:"telegram_allowed_chat_ids"`
	SecurityEnabled        bool    `json:"security_enabled"`
	SecurityAutoRespond    bool    `json:"security_auto_respond"`
	SecurityIntervalMin    int     `json:"security_interval_min"`
	TrustedSSHIPS          string  `json:"trusted_ssh_ips"`
	OutboundSpikeMbps      float64 `json:"outbound_spike_mbps"`
	ConnSpikeThreshold     uint64  `json:"conn_spike_threshold"`
}

// AIOpsConfigUpdateForm accepts updates from the admin UI.
// Leaving a secret field empty or equal to the masked placeholder preserves the existing secret;
// passing "__CLEAR__" explicitly clears it.
type AIOpsConfigUpdateForm struct {
	Enabled                bool    `json:"enabled"`
	SmallBaseURL           string  `json:"small_base_url"`
	SmallAPIKey            string  `json:"small_api_key"`
	SmallModel             string  `json:"small_model"`
	ShareProvider          bool    `json:"share_provider"`
	LargeBaseURL           string  `json:"large_base_url"`
	LargeAPIKey            string  `json:"large_api_key"`
	LargeModel             string  `json:"large_model"`
	PatrolIntervalMin      int     `json:"patrol_interval_min"`
	CPUThreshold           float64 `json:"cpu_threshold"`
	MemThreshold           float64 `json:"mem_threshold"`
	DiskThreshold          float64 `json:"disk_threshold"`
	CooldownMin            int     `json:"cooldown_min"`
	AutoSelfHeal           bool    `json:"auto_self_heal"`
	NotificationGroupID    uint64  `json:"notification_group_id"`
	TelegramEnabled        bool    `json:"telegram_enabled"`
	TelegramBotToken       string  `json:"telegram_bot_token"`
	TelegramEndpoint       string  `json:"telegram_endpoint"`
	TelegramAllowedChatIDs string  `json:"telegram_allowed_chat_ids"`
	SecurityEnabled        bool    `json:"security_enabled"`
	SecurityAutoRespond    bool    `json:"security_auto_respond"`
	SecurityIntervalMin    int     `json:"security_interval_min"`
	TrustedSSHIPS          string  `json:"trusted_ssh_ips"`
	OutboundSpikeMbps      float64 `json:"outbound_spike_mbps"`
	ConnSpikeThreshold     uint64  `json:"conn_spike_threshold"`
}

func MaskSecret(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if len(s) <= 8 {
		return "••••••••"
	}
	return s[:4] + "••••••••" + s[len(s)-4:]
}

func IsMaskedUnchanged(input, existing string) bool {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return true
	}
	return trimmed == MaskSecret(existing)
}

func (c *AIOpsConfig) ToView() AIOpsConfigView {
	return AIOpsConfigView{
		Enabled:                c.Enabled,
		SmallBaseURL:           c.SmallBaseURL,
		SmallAPIKeyMasked:      MaskSecret(c.SmallAPIKey),
		HasSmallKey:            strings.TrimSpace(c.SmallAPIKey) != "",
		SmallModel:             c.SmallModel,
		ShareProvider:          c.ShareProvider,
		LargeBaseURL:           c.LargeBaseURL,
		LargeAPIKeyMasked:      MaskSecret(c.LargeAPIKey),
		HasLargeKey:            strings.TrimSpace(c.LargeAPIKey) != "",
		LargeModel:             c.LargeModel,
		PatrolIntervalMin:      c.PatrolIntervalMin,
		CPUThreshold:           c.CPUThreshold,
		MemThreshold:           c.MemThreshold,
		DiskThreshold:          c.DiskThreshold,
		CooldownMin:            c.CooldownMin,
		AutoSelfHeal:           c.AutoSelfHeal,
		NotificationGroupID:    c.NotificationGroupID,
		TelegramEnabled:        c.TelegramEnabled,
		TelegramBotTokenMasked: MaskSecret(c.TelegramBotToken),
		HasTelegramToken:       strings.TrimSpace(c.TelegramBotToken) != "",
		TelegramEndpoint:       c.TelegramEndpoint,
		TelegramAllowedChatIDs: c.TelegramAllowedChatIDs,
		SecurityEnabled:        c.SecurityEnabled,
		SecurityAutoRespond:    c.SecurityAutoRespond,
		SecurityIntervalMin:    c.SecurityIntervalMin,
		TrustedSSHIPS:          c.TrustedSSHIPS,
		OutboundSpikeMbps:      c.OutboundSpikeMbps,
		ConnSpikeThreshold:     c.ConnSpikeThreshold,
	}
}

func (c *AIOpsConfig) EffectiveLargeEndpoint() (baseURL, apiKey, modelName string) {
	modelName = strings.TrimSpace(c.LargeModel)
	if modelName == "" {
		modelName = strings.TrimSpace(c.SmallModel)
	}
	if c.ShareProvider {
		return strings.TrimSpace(c.SmallBaseURL), strings.TrimSpace(c.SmallAPIKey), modelName
	}
	baseURL = strings.TrimSpace(c.LargeBaseURL)
	if baseURL == "" {
		baseURL = strings.TrimSpace(c.SmallBaseURL)
	}
	apiKey = strings.TrimSpace(c.LargeAPIKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(c.SmallAPIKey)
	}
	return baseURL, apiKey, modelName
}

// AIOpsToolStep records a single tool invocation made by the AI model.
type AIOpsToolStep struct {
	Tool       string `json:"tool"`
	ServerID   uint64 `json:"server_id,omitempty"`
	ServerName string `json:"server_name,omitempty"`
	Command    string `json:"command,omitempty"`
	Summary    string `json:"summary,omitempty"`
	Output     string `json:"output,omitempty"`
	DurationMs int64  `json:"duration_ms"`
	IsError    bool   `json:"is_error,omitempty"`
}

// AIOpsIncident records an anomaly detected by the sentinel or manual patrol,
// along with Small Model triage verdict and Large Model deep investigation.
type AIOpsIncident struct {
	ID             uint64    `gorm:"primaryKey" json:"id"`
	CreatedAt      time.Time `gorm:"index" json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
	ServerID       uint64    `gorm:"index" json:"server_id"`
	ServerName     string    `json:"server_name"`
	TriggerType    string    `json:"trigger_type"`    // cpu | memory | disk | offline | manual_patrol
	TriggerSummary string    `json:"trigger_summary"` // e.g. "CPU 95.2% / Load1 6.4"
	Status         string    `json:"status"`          // triaging | dismissed_by_small | diagnosing | reported | error
	Severity       string    `json:"severity"`        // low | medium | high
	SmallVerdict   string    `gorm:"type:text" json:"small_verdict"`
	LargeReport    string    `gorm:"type:text" json:"large_report"`
	ToolStepsJSON  string    `gorm:"type:text" json:"tool_steps_json"`
}

// AIOpsChatSession represents an interactive ops conversation (Web UI or Telegram).
type AIOpsChatSession struct {
	ID        uint64    `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `gorm:"index" json:"updated_at"`
	Title     string    `json:"title"`
	Source    string    `gorm:"index" json:"source"` // web | telegram:<chat_id>
}

// AIOpsChatMessage stores user and assistant messages within a session.
type AIOpsChatMessage struct {
	ID            uint64    `gorm:"primaryKey" json:"id"`
	CreatedAt     time.Time `gorm:"index" json:"created_at"`
	SessionID     uint64    `gorm:"index" json:"session_id"`
	Role          string    `json:"role"` // user | assistant
	Content       string    `gorm:"type:text" json:"content"`
	ModelUsed     string    `json:"model_used,omitempty"`
	Status        string    `json:"status"` // done | running | error | cancelled
	ToolStepsJSON string    `gorm:"type:text" json:"tool_steps_json,omitempty"`
}
