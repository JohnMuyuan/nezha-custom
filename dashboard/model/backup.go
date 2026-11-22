package model

import (
	"strings"
	"time"
)

// BackupConfig stores the singleton automatic backup & migration configuration in SQLite (ID = 1).
// Secret fields (EncryptPassword, TelegramBotToken) are never serialized to JSON directly.
type BackupConfig struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement:false" json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	TelegramAutoEnabled bool   `json:"telegram_auto_enabled"` // 每天定时自动发到 Telegram 机器人私聊
	ScheduleHour        int    `json:"schedule_hour"`         // 每日备份小时 (0-23，默认 3)
	ScheduleMinute      int    `json:"schedule_minute"`       // 每日备份分钟 (0-59，默认 15)
	IncludeTSDB         bool   `json:"include_tsdb"`          // 是否包含 tsdb 历史延迟图表目录（默认 false）
	EncryptPassword     string `json:"-"`                     // AES-256 备份加密口令（留空则不加密）

	UseAIOpsTelegram bool   `json:"use_ai_ops_telegram"` // 默认复用 AI 运维助手中已绑定的 Telegram 机器人
	TelegramBotToken string `json:"-"`                   // 独立备份 Bot Token（UseAIOpsTelegram=false 时生效）
	TelegramEndpoint string `json:"telegram_endpoint"`   // 默认 https://api.telegram.org
	TelegramChatID   string `json:"telegram_chat_id"`    // 独立接收备份文件的管理员 Chat ID

	LastBackupAt        *time.Time `json:"last_backup_at,omitempty"`
	LastBackupStatus    string     `json:"last_backup_status"` // ok | error | ""
	LastBackupMessage   string     `json:"last_backup_message"`
	LastBackupSizeBytes int64      `json:"last_backup_size_bytes"`
	LastBackupFilename  string     `json:"last_backup_filename"`
	LastBackupEncrypted bool       `json:"last_backup_encrypted"`
}

// BackupConfigView is the admin-facing DTO with masked secrets and live migration metadata.
type BackupConfigView struct {
	TelegramAutoEnabled    bool       `json:"telegram_auto_enabled"`
	ScheduleHour           int        `json:"schedule_hour"`
	ScheduleMinute         int        `json:"schedule_minute"`
	IncludeTSDB            bool       `json:"include_tsdb"`
	EncryptPasswordMasked  string     `json:"encrypt_password_masked"`
	HasEncryptPassword     bool       `json:"has_encrypt_password"`
	UseAIOpsTelegram       bool       `json:"use_ai_ops_telegram"`
	TelegramBotTokenMasked string     `json:"telegram_bot_token_masked"`
	HasTelegramToken       bool       `json:"has_telegram_token"`
	TelegramEndpoint       string     `json:"telegram_endpoint"`
	TelegramChatID         string     `json:"telegram_chat_id"`
	LastBackupAt           *time.Time `json:"last_backup_at,omitempty"`
	LastBackupStatus       string     `json:"last_backup_status"`
	LastBackupMessage      string     `json:"last_backup_message"`
	LastBackupSizeBytes    int64      `json:"last_backup_size_bytes"`
	LastBackupFilename     string     `json:"last_backup_filename"`
	LastBackupEncrypted    bool       `json:"last_backup_encrypted"`

	// Live runtime context for the Beginner Migration Wizard
	AIOpsTelegramReady    bool   `json:"ai_ops_telegram_ready"`
	EffectiveTelegramHint string `json:"effective_telegram_hint"`
	InstallHost           string `json:"install_host"`
	ListenPort            uint   `json:"listen_port"`
	SiteName              string `json:"site_name"`
	Version               string `json:"version"`
	DBSizeBytes           int64  `json:"db_size_bytes"`
	ConfigSizeBytes       int64  `json:"config_size_bytes"`
	TSDBSizeBytes         int64  `json:"tsdb_size_bytes"`
	TotalServers          int    `json:"total_servers"`
	OnlineServers         int    `json:"online_servers"`
}

// BackupConfigUpdateForm accepts updates from the Admin UI.
type BackupConfigUpdateForm struct {
	TelegramAutoEnabled bool   `json:"telegram_auto_enabled"`
	ScheduleHour        int    `json:"schedule_hour"`
	ScheduleMinute      int    `json:"schedule_minute"`
	IncludeTSDB         bool   `json:"include_tsdb"`
	EncryptPassword     string `json:"encrypt_password"`
	UseAIOpsTelegram    bool   `json:"use_ai_ops_telegram"`
	TelegramBotToken    string `json:"telegram_bot_token"`
	TelegramEndpoint    string `json:"telegram_endpoint"`
	TelegramChatID      string `json:"telegram_chat_id"`
}

func (c *BackupConfig) ToBaseView() BackupConfigView {
	return BackupConfigView{
		TelegramAutoEnabled:    c.TelegramAutoEnabled,
		ScheduleHour:           c.ScheduleHour,
		ScheduleMinute:         c.ScheduleMinute,
		IncludeTSDB:            c.IncludeTSDB,
		EncryptPasswordMasked:  MaskSecret(c.EncryptPassword),
		HasEncryptPassword:     strings.TrimSpace(c.EncryptPassword) != "",
		UseAIOpsTelegram:       c.UseAIOpsTelegram,
		TelegramBotTokenMasked: MaskSecret(c.TelegramBotToken),
		HasTelegramToken:       strings.TrimSpace(c.TelegramBotToken) != "",
		TelegramEndpoint:       c.TelegramEndpoint,
		TelegramChatID:         c.TelegramChatID,
		LastBackupAt:           c.LastBackupAt,
		LastBackupStatus:       c.LastBackupStatus,
		LastBackupMessage:      c.LastBackupMessage,
		LastBackupSizeBytes:    c.LastBackupSizeBytes,
		LastBackupFilename:     c.LastBackupFilename,
		LastBackupEncrypted:    c.LastBackupEncrypted,
	}
}
