package singleton

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/nezhahq/nezha/model"
)

var (
	BackupShared     *BackupClass
	ConfigFilePath   = "data/config.yaml"
	DatabaseFilePath = "data/sqlite.db"
)

const (
	telegramMaxFileBytes = 48 * 1024 * 1024 // Telegram Bot API limit is 50MB; keep 2MB safety margin
	maxRestoreBytes      = 512 * 1024 * 1024
)

var safeHostCharRegex = regexp.MustCompile(`^[a-zA-Z0-9._:\-\[\]]+$`)

type BackupManifest struct {
	Version      string    `json:"version"`
	CreatedAt    time.Time `json:"created_at"`
	SiteName     string    `json:"site_name"`
	InstallHost  string    `json:"install_host"`
	ListenPort   uint      `json:"listen_port"`
	TotalServers int       `json:"total_servers"`
	IncludeTSDB  bool      `json:"include_tsdb"`
	Encrypted    bool      `json:"encrypted"`
}

type AgentMigrateItemResult struct {
	ServerID   uint64 `json:"server_id"`
	ServerName string `json:"server_name"`
	Success    bool   `json:"success"`
	Message    string `json:"message"`
}

type BackupClass struct {
	cfgMu sync.RWMutex
	cfg   model.BackupConfig

	opMu          sync.Mutex
	schedMu       sync.Mutex
	lastAutoDay   string
	restartHook   func()
}

func defaultBackupConfig() model.BackupConfig {
	return model.BackupConfig{
		ID:                  1,
		TelegramAutoEnabled: false,
		ScheduleHour:        3,
		ScheduleMinute:      15,
		IncludeTSDB:         false,
		UseAIOpsTelegram:    true,
		TelegramEndpoint:    "https://api.telegram.org",
	}
}

func NewBackupClass() *BackupClass {
	b := &BackupClass{
		cfg: defaultBackupConfig(),
		restartHook: func() {
			time.AfterFunc(1500*time.Millisecond, func() {
				log.Println("NEZHA>> Backup restore completed; exiting cleanly so Docker/systemd restarts into restored data...")
				CloseTSDB()
				if DB != nil {
					if sqlDB, err := DB.DB(); err == nil {
						_ = sqlDB.Close()
					}
				}
				_ = os.Remove(DatabaseFilePath + "-wal")
				_ = os.Remove(DatabaseFilePath + "-shm")
				os.Exit(0)
			})
		},
	}
	b.loadConfigFromDB()
	return b
}

func (b *BackupClass) loadConfigFromDB() {
	if DB == nil {
		return
	}
	var row model.BackupConfig
	if err := DB.First(&row, 1).Error; err != nil {
		def := defaultBackupConfig()
		// If user already configured AI Ops Telegram bot, default-enable daily 03:15 backup for convenience
		if AIOpsShared != nil {
			aiCfg := AIOpsShared.GetConfigSnapshot()
			if aiCfg.TelegramEnabled && strings.TrimSpace(aiCfg.TelegramBotToken) != "" && strings.TrimSpace(aiCfg.TelegramAllowedChatIDs) != "" {
				def.TelegramAutoEnabled = true
			}
		}
		_ = DB.Create(&def).Error
		b.cfgMu.Lock()
		b.cfg = def
		b.cfgMu.Unlock()
		return
	}
	if row.ScheduleHour < 0 || row.ScheduleHour > 23 {
		row.ScheduleHour = 3
	}
	if row.ScheduleMinute < 0 || row.ScheduleMinute > 59 {
		row.ScheduleMinute = 15
	}
	if strings.TrimSpace(row.TelegramEndpoint) == "" {
		row.TelegramEndpoint = "https://api.telegram.org"
	}
	b.cfgMu.Lock()
	b.cfg = row
	b.cfgMu.Unlock()
}

func (b *BackupClass) GetConfigSnapshot() model.BackupConfig {
	b.cfgMu.RLock()
	defer b.cfgMu.RUnlock()
	return b.cfg
}

func (b *BackupClass) GetConfigView() model.BackupConfigView {
	cfg := b.GetConfigSnapshot()
	view := cfg.ToBaseView()
	view.Version = Version

	if Conf != nil {
		view.InstallHost = strings.TrimSpace(Conf.InstallHost)
		view.ListenPort = uint(Conf.ListenPort)
		view.SiteName = strings.TrimSpace(Conf.SiteName)
	}
	if view.ListenPort == 0 {
		view.ListenPort = 8008
	}

	if fi, err := os.Stat(DatabaseFilePath); err == nil {
		view.DBSizeBytes = fi.Size()
	}
	if fi, err := os.Stat(ConfigFilePath); err == nil {
		view.ConfigSizeBytes = fi.Size()
	}
	view.TSDBSizeBytes = dirSizeBytes(b.resolveTSDBDir())

	if ServerShared != nil {
		now := time.Now()
		for _, srv := range ServerShared.Range {
			if srv == nil {
				continue
			}
			view.TotalServers++
			snap := srv.RuntimeSnapshot()
			if srv.GetTaskStream() != nil && !snap.LastActive.IsZero() && now.Sub(snap.LastActive) < 90*time.Second {
				view.OnlineServers++
			}
		}
	}

	if AIOpsShared != nil {
		aiCfg := AIOpsShared.GetConfigSnapshot()
		if aiCfg.TelegramEnabled && strings.TrimSpace(aiCfg.TelegramBotToken) != "" && strings.TrimSpace(aiCfg.TelegramAllowedChatIDs) != "" {
			view.AIOpsTelegramReady = true
			view.EffectiveTelegramHint = fmt.Sprintf("复用 AI 运维机器人（接收 Chat ID: %s）", strings.TrimSpace(aiCfg.TelegramAllowedChatIDs))
		}
	}
	if !cfg.UseAIOpsTelegram {
		if strings.TrimSpace(cfg.TelegramBotToken) != "" && strings.TrimSpace(cfg.TelegramChatID) != "" {
			view.EffectiveTelegramHint = fmt.Sprintf("独立备份机器人（接收 Chat ID: %s）", strings.TrimSpace(cfg.TelegramChatID))
		} else {
			view.EffectiveTelegramHint = "尚未填完整独立备份机器人 Token 与 Chat ID"
		}
	} else if !view.AIOpsTelegramReady {
		view.EffectiveTelegramHint = "AI 运维里尚未绑定 Telegram 机器人（请先去 AI 运维绑定，或关闭复用开关单独填写）"
	}

	return view
}

func (b *BackupClass) UpdateConfig(form model.BackupConfigUpdateForm) (model.BackupConfigView, error) {
	b.cfgMu.Lock()
	next := b.cfg
	next.ID = 1
	next.TelegramAutoEnabled = form.TelegramAutoEnabled
	if form.ScheduleHour >= 0 && form.ScheduleHour <= 23 {
		next.ScheduleHour = form.ScheduleHour
	}
	if form.ScheduleMinute >= 0 && form.ScheduleMinute <= 59 {
		next.ScheduleMinute = form.ScheduleMinute
	}
	next.IncludeTSDB = form.IncludeTSDB
	next.UseAIOpsTelegram = form.UseAIOpsTelegram

	if form.EncryptPassword == "__CLEAR__" {
		next.EncryptPassword = ""
	} else if !model.IsMaskedUnchanged(form.EncryptPassword, next.EncryptPassword) {
		next.EncryptPassword = strings.TrimSpace(form.EncryptPassword)
	}

	if form.TelegramBotToken == "__CLEAR__" {
		next.TelegramBotToken = ""
	} else if !model.IsMaskedUnchanged(form.TelegramBotToken, next.TelegramBotToken) {
		next.TelegramBotToken = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(form.TelegramBotToken), "bot"))
	}

	ep := strings.TrimSpace(form.TelegramEndpoint)
	if ep == "" {
		ep = "https://api.telegram.org"
	}
	next.TelegramEndpoint = strings.TrimRight(ep, "/")
	next.TelegramChatID = strings.TrimSpace(form.TelegramChatID)

	if DB != nil {
		if err := DB.Save(&next).Error; err != nil {
			b.cfgMu.Unlock()
			return model.BackupConfigView{}, err
		}
	}
	b.cfg = next
	b.cfgMu.Unlock()
	return b.GetConfigView(), nil
}

func (b *BackupClass) resolveTSDBDir() string {
	if Conf != nil && strings.TrimSpace(Conf.TSDB.DataPath) != "" {
		return Conf.TSDB.DataPath
	}
	return filepath.Join(filepath.Dir(DatabaseFilePath), "tsdb")
}

func dirSizeBytes(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(_ string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if fi, sErr := d.Info(); sErr == nil {
			total += fi.Size()
		}
		return nil
	})
	return total
}

func (b *BackupClass) resolveEffectiveTelegram(cfg model.BackupConfig) (endpoint, token string, chatIDs []int64, err error) {
	if cfg.UseAIOpsTelegram && AIOpsShared != nil {
		aiCfg := AIOpsShared.GetConfigSnapshot()
		endpoint = strings.TrimRight(strings.TrimSpace(aiCfg.TelegramEndpoint), "/")
		token = strings.TrimSpace(aiCfg.TelegramBotToken)
		for id := range parseAllowedTelegramIDs(aiCfg.TelegramAllowedChatIDs) {
			chatIDs = append(chatIDs, id)
		}
	} else {
		endpoint = strings.TrimRight(strings.TrimSpace(cfg.TelegramEndpoint), "/")
		token = strings.TrimSpace(cfg.TelegramBotToken)
		for id := range parseAllowedTelegramIDs(cfg.TelegramChatID) {
			chatIDs = append(chatIDs, id)
		}
	}
	if endpoint == "" {
		endpoint = "https://api.telegram.org"
	}
	slices.Sort(chatIDs)
	if token == "" || len(chatIDs) == 0 {
		return "", "", nil, errors.New("未配置有效的 Telegram Bot Token 或管理员 Chat ID（可先在「AI 运维助手」绑定，或取消复用后在此处单独填写）")
	}
	return endpoint, token, chatIDs, nil
}

// CreateBackupArchive creates a consistent SQLite hot backup (VACUUM INTO) + config.yaml +
// docker-compose.yaml + restore.sh + README-MIGRATE.txt archive (optionally with tsdb and AES-256 encryption).
func (b *BackupClass) CreateBackupArchive(includeTSDB bool, passphrase string) ([]byte, string, bool, BackupManifest, error) {
	b.opMu.Lock()
	defer b.opMu.Unlock()

	now := time.Now()
	if Loc != nil {
		now = now.In(Loc)
	}

	tmpDir, err := os.MkdirTemp("", "nezha-backup-*")
	if err != nil {
		return nil, "", false, BackupManifest{}, fmt.Errorf("创建临时备份目录失败: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// 1. Safe hot SQLite snapshot via VACUUM INTO (never copies a half-written live DB!)
	snapDBPath := filepath.Join(tmpDir, "sqlite.db")
	if DB != nil {
		if vErr := DB.Exec("VACUUM INTO ?", filepath.ToSlash(snapDBPath)).Error; vErr != nil {
			// Fallback to direct copy only if VACUUM INTO is unavailable on an unusual backend
			log.Printf("NEZHA>> Backup VACUUM INTO fallback (%v), copying db file", vErr)
			if cErr := copyFileContents(DatabaseFilePath, snapDBPath); cErr != nil {
				return nil, "", false, BackupManifest{}, fmt.Errorf("导出 SQLite 数据库失败: %w", cErr)
			}
		}
	} else if cErr := copyFileContents(DatabaseFilePath, snapDBPath); cErr != nil {
		return nil, "", false, BackupManifest{}, fmt.Errorf("读取 SQLite 数据库失败: %w", cErr)
	}

	configBytes, err := os.ReadFile(ConfigFilePath)
	if err != nil {
		return nil, "", false, BackupManifest{}, fmt.Errorf("读取配置文件 %s 失败: %w", ConfigFilePath, err)
	}
	dbBytes, err := os.ReadFile(snapDBPath)
	if err != nil {
		return nil, "", false, BackupManifest{}, fmt.Errorf("读取数据库快照失败: %w", err)
	}

	var listenPort uint = 8008
	siteName := "Nezha Monitoring"
	installHost := ""
	if Conf != nil {
		if Conf.ListenPort > 0 {
			listenPort = uint(Conf.ListenPort)
		}
		if strings.TrimSpace(Conf.SiteName) != "" {
			siteName = strings.TrimSpace(Conf.SiteName)
		}
		installHost = strings.TrimSpace(Conf.InstallHost)
	}
	totalServers := 0
	if ServerShared != nil {
		for _, srv := range ServerShared.Range {
			if srv != nil {
				totalServers++
			}
		}
	}

	passphrase = strings.TrimSpace(passphrase)
	encrypted := passphrase != ""
	manifest := BackupManifest{
		Version:      Version,
		CreatedAt:    now,
		SiteName:     siteName,
		InstallHost:  installHost,
		ListenPort:   listenPort,
		TotalServers: totalServers,
		IncludeTSDB:  includeTSDB,
		Encrypted:    encrypted,
	}

	var buf bytes.Buffer
	gzw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gzw)

	addBytes := func(tarPath string, content []byte, mode int64) error {
		hdr := &tar.Header{
			Name:    tarPath,
			Mode:    mode,
			Size:    int64(len(content)),
			ModTime: now,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		_, err := tw.Write(content)
		return err
	}

	if err := addBytes("data/config.yaml", configBytes, 0600); err != nil {
		return nil, "", false, manifest, err
	}
	if err := addBytes("data/sqlite.db", dbBytes, 0600); err != nil {
		return nil, "", false, manifest, err
	}
	manifestBytes, _ := json.MarshalIndent(manifest, "", "  ")
	if err := addBytes("backup-manifest.json", manifestBytes, 0644); err != nil {
		return nil, "", false, manifest, err
	}
	if err := addBytes("docker-compose.yaml", []byte(buildMigrationComposeYAML(listenPort)), 0644); err != nil {
		return nil, "", false, manifest, err
	}
	if err := addBytes("restore.sh", []byte(buildMigrationRestoreScript(listenPort, installHost)), 0755); err != nil {
		return nil, "", false, manifest, err
	}
	if err := addBytes("README-MIGRATE.txt", []byte(buildMigrationReadme(manifest)), 0644); err != nil {
		return nil, "", false, manifest, err
	}

	if includeTSDB {
		tsdbDir := b.resolveTSDBDir()
		if fi, statErr := os.Stat(tsdbDir); statErr == nil && fi.IsDir() {
			_ = filepath.WalkDir(tsdbDir, func(path string, d os.DirEntry, wErr error) error {
				if wErr != nil || d.IsDir() {
					return nil
				}
				rel, rErr := filepath.Rel(tsdbDir, path)
				if rErr != nil {
					return nil
				}
				if strings.HasSuffix(rel, ".lock") || strings.Contains(rel, "flock") {
					return nil
				}
				data, rdErr := os.ReadFile(path)
				if rdErr != nil {
					return nil
				}
				return addBytes("data/tsdb/"+filepath.ToSlash(rel), data, 0600)
			})
		}
	}

	if err := tw.Close(); err != nil {
		return nil, "", false, manifest, err
	}
	if err := gzw.Close(); err != nil {
		return nil, "", false, manifest, err
	}

	rawArchive := buf.Bytes()
	stamp := now.Format("20060102-150405")
	filename := fmt.Sprintf("nezha-backup-%s.tar.gz", stamp)

	if encrypted {
		encBytes, eErr := EncryptOpenSSLCompatible(rawArchive, passphrase)
		if eErr != nil {
			return nil, "", false, manifest, eErr
		}
		return encBytes, filename + ".enc", true, manifest, nil
	}
	return rawArchive, filename, false, manifest, nil
}

// SendBackupToTelegram creates a fresh backup archive and uploads it as a document to the configured Telegram chat(s).
func (b *BackupClass) SendBackupToTelegram(ctx context.Context, manual bool) (model.BackupConfigView, error) {
	cfg := b.GetConfigSnapshot()
	endpoint, token, chatIDs, err := b.resolveEffectiveTelegram(cfg)
	if err != nil {
		b.recordBackupOutcome("error", err.Error(), 0, "", false)
		return b.GetConfigView(), err
	}

	includeTSDB := cfg.IncludeTSDB
	archiveBytes, filename, encrypted, manifest, err := b.CreateBackupArchive(includeTSDB, cfg.EncryptPassword)
	if err != nil {
		b.recordBackupOutcome("error", err.Error(), 0, "", false)
		return b.GetConfigView(), err
	}

	downgradedNote := ""
	if len(archiveBytes) > telegramMaxFileBytes && includeTSDB {
		// Automatically fall back to core-only backup so critical data always reaches Telegram
		archiveBytes, filename, encrypted, manifest, err = b.CreateBackupArchive(false, cfg.EncryptPassword)
		if err != nil {
			b.recordBackupOutcome("error", err.Error(), 0, "", false)
			return b.GetConfigView(), err
		}
		downgradedNote = "\n⚠️ 含 TSDB 时超过 Telegram 50MB 限制，已自动降级为核心数据备份。"
	}
	if len(archiveBytes) > telegramMaxFileBytes {
		sizeErr := fmt.Errorf("备份包体积 %.1f MB 超过 Telegram 机器人单文件上限 (50 MB)，请改用本地下载", float64(len(archiveBytes))/(1024*1024))
		b.recordBackupOutcome("error", sizeErr.Error(), int64(len(archiveBytes)), filename, encrypted)
		return b.GetConfigView(), sizeErr
	}

	triggerLabel := "定时自动热备"
	if manual {
		triggerLabel = "手动立即备份"
	}
	encLabel := "🔓 未加密（建议在面板设置备份密码）"
	if encrypted {
		encLabel = "🔐 已 AES-256 加密（还原时需输入你的备份口令）"
	}
	caption := fmt.Sprintf(
		"🧳 哪吒面板【%s】%s\n📅 时间：%s\n🖥️ 纳管小鸡：%d 台 | 接入地址：%s\n📦 大小：%s | %s%s\n💡 换新机器只需在面板「备份与搬家」上传此文件，或用内附 restore.sh 即可 3 分钟恢复并自动重连全部小鸡！",
		manifest.SiteName,
		triggerLabel,
		manifest.CreatedAt.Format("2006-01-02 15:04:05"),
		manifest.TotalServers,
		manifest.InstallHost,
		formatByteSize(int64(len(archiveBytes))),
		encLabel,
		downgradedNote,
	)

	var sendErrors []string
	for _, cid := range chatIDs {
		if sErr := uploadTelegramDocument(ctx, endpoint, token, cid, filename, archiveBytes, caption); sErr != nil {
			sendErrors = append(sendErrors, fmt.Sprintf("Chat %d: %v", cid, sErr))
		}
	}
	if len(sendErrors) > 0 {
		msg := "Telegram 推送失败: " + strings.Join(sendErrors, "; ")
		b.recordBackupOutcome("error", msg, int64(len(archiveBytes)), filename, encrypted)
		return b.GetConfigView(), errors.New(msg)
	}

	okMsg := fmt.Sprintf("已成功发送 %s（%s）到 Telegram 私聊", filename, formatByteSize(int64(len(archiveBytes))))
	b.recordBackupOutcome("ok", okMsg, int64(len(archiveBytes)), filename, encrypted)
	return b.GetConfigView(), nil
}

func (b *BackupClass) recordBackupOutcome(status, msg string, sizeBytes int64, filename string, encrypted bool) {
	now := time.Now()
	b.cfgMu.Lock()
	b.cfg.LastBackupAt = &now
	b.cfg.LastBackupStatus = status
	b.cfg.LastBackupMessage = msg
	if sizeBytes > 0 {
		b.cfg.LastBackupSizeBytes = sizeBytes
	}
	if filename != "" {
		b.cfg.LastBackupFilename = filename
	}
	b.cfg.LastBackupEncrypted = encrypted
	snap := b.cfg
	b.cfgMu.Unlock()

	if DB != nil {
		_ = DB.Save(&snap).Error
	}
}

// RunScheduledBackupTick is called every 1 minute by Cron; fires once per day at ScheduleHour:ScheduleMinute.
func (b *BackupClass) RunScheduledBackupTick() {
	cfg := b.GetConfigSnapshot()
	if !cfg.TelegramAutoEnabled {
		return
	}
	now := time.Now()
	if Loc != nil {
		now = now.In(Loc)
	}
	if now.Hour() != cfg.ScheduleHour || now.Minute() != cfg.ScheduleMinute {
		return
	}
	today := now.Format("2006-01-02")

	b.schedMu.Lock()
	if b.lastAutoDay == today {
		b.schedMu.Unlock()
		return
	}
	b.lastAutoDay = today
	b.schedMu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		if _, err := b.SendBackupToTelegram(ctx, false); err != nil {
			log.Printf("NEZHA>> Daily Telegram auto-backup failed: %v", err)
		} else {
			log.Printf("NEZHA>> Daily Telegram auto-backup sent successfully")
		}
	}()
}

// RestoreFromArchive validates, decrypts (if encrypted), snapshots current live files, restores config.yaml +
// sqlite.db (+ optional tsdb), and schedules a clean restart so Docker/systemd boots straight into the restored data.
func (b *BackupClass) RestoreFromArchive(archiveBytes []byte, passphrase string) (preBackupDir string, restoredManifest *BackupManifest, err error) {
	b.opMu.Lock()
	defer b.opMu.Unlock()

	if len(archiveBytes) == 0 {
		return "", nil, errors.New("上传的备份文件为空")
	}
	if len(archiveBytes) > maxRestoreBytes {
		return "", nil, errors.New("备份文件超过 512 MB 安全上限")
	}

	rawTarGz := archiveBytes
	if IsOpenSSLEncrypted(archiveBytes) {
		pwd := strings.TrimSpace(passphrase)
		if pwd == "" {
			pwd = strings.TrimSpace(b.GetConfigSnapshot().EncryptPassword)
		}
		rawTarGz, err = DecryptOpenSSLCompatible(archiveBytes, pwd)
		if err != nil {
			return "", nil, err
		}
	}

	gzr, err := gzip.NewReader(bytes.NewReader(rawTarGz))
	if err != nil {
		return "", nil, errors.New("解压失败：不是有效的 .tar.gz 备份包（若已加密请检查密码是否正确）")
	}
	defer gzr.Close()

	stageDir, err := os.MkdirTemp("", "nezha-restore-*")
	if err != nil {
		return "", nil, fmt.Errorf("创建临时解压目录失败: %w", err)
	}
	defer os.RemoveAll(stageDir)

	tr := tar.NewReader(gzr)
	var totalExtracted int64
	for {
		hdr, nextErr := tr.Next()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			return "", nil, fmt.Errorf("解析备份归档失败: %w", nextErr)
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		cleanRel := filepath.Clean(strings.TrimPrefix(hdr.Name, "./"))
		if cleanRel == "." || strings.HasPrefix(cleanRel, "..") || filepath.IsAbs(cleanRel) {
			return "", nil, fmt.Errorf("安全拦截：备份包包含非法路径 %q", hdr.Name)
		}
		targetPath := filepath.Join(stageDir, cleanRel)
		if !strings.HasPrefix(targetPath, stageDir+string(os.PathSeparator)) {
			return "", nil, fmt.Errorf("安全拦截：备份路径越界 %q", hdr.Name)
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0700); err != nil {
			return "", nil, err
		}
		totalExtracted += hdr.Size
		if totalExtracted > maxRestoreBytes {
			return "", nil, errors.New("安全拦截：解压体积超过 512 MB 上限")
		}
		outFile, cErr := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
		if cErr != nil {
			return "", nil, cErr
		}
		_, cpErr := io.Copy(outFile, io.LimitReader(tr, hdr.Size+1))
		outFile.Close()
		if cpErr != nil {
			return "", nil, cpErr
		}
	}

	// Support both standard `data/config.yaml` and bare `config.yaml` layouts
	stagedConfig := filepath.Join(stageDir, "data", "config.yaml")
	if _, sErr := os.Stat(stagedConfig); sErr != nil {
		stagedConfig = filepath.Join(stageDir, "config.yaml")
	}
	stagedDB := filepath.Join(stageDir, "data", "sqlite.db")
	if _, sErr := os.Stat(stagedDB); sErr != nil {
		stagedDB = filepath.Join(stageDir, "sqlite.db")
	}

	cfgData, err := os.ReadFile(stagedConfig)
	if err != nil {
		return "", nil, errors.New("备份包校验失败：缺少 data/config.yaml 配置文件")
	}
	var yamlProbe map[string]any
	if err := yaml.Unmarshal(cfgData, &yamlProbe); err != nil || len(yamlProbe) == 0 {
		return "", nil, errors.New("备份包校验失败：config.yaml 格式无效")
	}

	dbData, err := os.ReadFile(stagedDB)
	if err != nil {
		return "", nil, errors.New("备份包校验失败：缺少 data/sqlite.db 数据库文件")
	}
	if len(dbData) < 4096 || !bytes.HasPrefix(dbData, []byte("SQLite format 3\x00")) {
		return "", nil, errors.New("备份包校验失败：sqlite.db 不是有效的 SQLite3 数据库文件")
	}

	if mfBytes, mfErr := os.ReadFile(filepath.Join(stageDir, "backup-manifest.json")); mfErr == nil {
		var mf BackupManifest
		if json.Unmarshal(mfBytes, &mf) == nil {
			restoredManifest = &mf
		}
	}

	// Preserve a pre-restore safety snapshot before overwriting live data
	dataDir := filepath.Dir(DatabaseFilePath)
	preBackupDir = filepath.Join(dataDir, "pre-restore-"+time.Now().Format("20060102-150405"))
	_ = os.MkdirAll(preBackupDir, 0700)
	_ = copyFileContents(ConfigFilePath, filepath.Join(preBackupDir, "config.yaml"))
	_ = copyFileContents(DatabaseFilePath, filepath.Join(preBackupDir, "sqlite.db"))

	if DB != nil {
		_ = DB.Exec("PRAGMA wal_checkpoint(TRUNCATE)").Error
	}

	// Atomically write restored config.yaml and sqlite.db (0600)
	if err := atomicReplaceFile(ConfigFilePath, cfgData, 0600); err != nil {
		return preBackupDir, restoredManifest, fmt.Errorf("写入 config.yaml 失败: %w", err)
	}
	_ = os.Remove(DatabaseFilePath + "-wal")
	_ = os.Remove(DatabaseFilePath + "-shm")
	if err := atomicReplaceFile(DatabaseFilePath, dbData, 0600); err != nil {
		return preBackupDir, restoredManifest, fmt.Errorf("写入 sqlite.db 失败: %w", err)
	}

	// Optional TSDB directory swap if present in archive
	stagedTSDB := filepath.Join(stageDir, "data", "tsdb")
	if fi, sErr := os.Stat(stagedTSDB); sErr == nil && fi.IsDir() {
		liveTSDB := b.resolveTSDBDir()
		CloseTSDB()
		_ = os.Rename(liveTSDB, filepath.Join(preBackupDir, "tsdb"))
		_ = copyDirRecursive(stagedTSDB, liveTSDB)
	}

	if b.restartHook != nil {
		b.restartHook()
	}
	return preBackupDir, restoredManifest, nil
}

// BatchMigrateAgentEndpoint updates the `server:` and `tls:` fields in nezha-agent's config.yml
// across selected online Linux servers via the existing Agent gRPC channel, then schedules a delayed
// restart (2s) so the old Dashboard receives confirmation before each agent switches over.
func (b *BackupClass) BatchMigrateAgentEndpoint(
	ctx context.Context,
	serverIDs []uint64,
	newServerAddr string,
	useTLS bool,
) ([]AgentMigrateItemResult, error) {
	newServerAddr = strings.TrimSpace(newServerAddr)
	if newServerAddr == "" {
		return nil, errors.New("请输入新的面板接入地址（如 new.example.com:20070）")
	}
	host, portStr, splitErr := net.SplitHostPort(newServerAddr)
	if splitErr != nil || host == "" || !safeHostCharRegex.MatchString(host) {
		return nil, errors.New("新接入地址格式不正确，必须是「域名:端口」或「IP:端口」（例如 new.example.com:20070）")
	}
	portNum, pErr := strconv.Atoi(portStr)
	if pErr != nil || portNum < 1 || portNum > 65535 {
		return nil, errors.New("端口号必须在 1~65535 之间")
	}
	if len(serverIDs) == 0 {
		return nil, errors.New("请至少勾选 1 台在线 Linux 服务器")
	}
	if ServerShared == nil || AIOpsShared == nil {
		return nil, errors.New("服务器注册表或 Agent 通道尚未就绪")
	}

	tlsVal := "false"
	if useTLS {
		tlsVal = "true"
	}

	migrateScript := fmt.Sprintf(`set -e
NEW_SERVER='%s'
NEW_TLS='%s'
CFG=""
if command -v systemctl >/dev/null 2>&1; then
  CFG=$(systemctl cat nezha-agent 2>/dev/null | grep -E 'ExecStart=' | grep -oE -- '-c[ =]+[^[:space:]]+' | head -n1 | sed -E 's/^-c[ =]+//')
fi
if [ -z "$CFG" ] || [ ! -f "$CFG" ]; then
  for p in /opt/nezha/agent/config.yml /etc/nezha-agent/config.yml /opt/nezha/agent/config.yaml; do
    if [ -f "$p" ]; then CFG="$p"; break; fi
  done
fi
if [ -z "$CFG" ] || [ ! -f "$CFG" ]; then
  echo "MIGRATE_ERR=未找到 nezha-agent 配置文件"
  exit 1
fi
BAK="${CFG}.bak-$(date +%%Y%%m%%d-%%H%%M%%S)"
cp -a "$CFG" "$BAK"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$CFG" "$NEW_SERVER" "$NEW_TLS" <<'PY'
import sys, re
path, new_srv, new_tls = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, 'r', encoding='utf-8').read()
if re.search(r'(?m)^server\s*:', text):
    text = re.sub(r'(?m)^server\s*:.*$', f'server: {new_srv}', text, count=1)
else:
    text = f'server: {new_srv}\n' + text
if re.search(r'(?m)^tls\s*:', text):
    text = re.sub(r'(?m)^tls\s*:.*$', f'tls: {new_tls}', text, count=1)
else:
    text = text.rstrip('\n') + f'\ntls: {new_tls}\n'
open(path, 'w', encoding='utf-8').write(text)
PY
else
  sed -i -E "s|^server:[[:space:]]*.*$|server: ${NEW_SERVER}|" "$CFG"
  if grep -qE '^tls:' "$CFG"; then
    sed -i -E "s|^tls:[[:space:]]*.*$|tls: ${NEW_TLS}|" "$CFG"
  else
    echo "tls: ${NEW_TLS}" >> "$CFG"
  fi
fi
grep -E '^(server|tls):' "$CFG"
nohup sh -c 'sleep 2; (systemctl restart nezha-agent 2>/dev/null || service nezha-agent restart 2>/dev/null || rc-service nezha-agent restart 2>/dev/null || true)' >/dev/null 2>&1 &
echo "MIGRATE_OK cfg=$CFG bak=$BAK"`, newServerAddr, tlsVal)

	results := make([]AgentMigrateItemResult, len(serverIDs))
	sem := make(chan struct{}, 5)
	var wg sync.WaitGroup

	for i, sid := range serverIDs {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int, id uint64) {
			defer wg.Done()
			defer func() { <-sem }()

			srv, ok := ServerShared.Get(id)
			if !ok || srv == nil {
				results[idx] = AgentMigrateItemResult{ServerID: id, Success: false, Message: "服务器不存在"}
				return
			}
			res := AgentMigrateItemResult{ServerID: id, ServerName: srv.Name}
			snap := srv.RuntimeSnapshot()
			if snap.Host != nil && strings.Contains(strings.ToLower(snap.Host.Platform), "windows") {
				res.Message = "暂仅支持自动迁移 Linux Agent，Windows 节点请手动修改 config.yml"
				results[idx] = res
				return
			}
			if srv.GetTaskStream() == nil {
				res.Message = "当前离线，无法下发迁移指令"
				results[idx] = res
				return
			}

			cmdCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
			wrapped := wrapCommandForAgent(srv, migrateScript)
			out, okExec, err := AIOpsShared.DispatchAgentCommand(cmdCtx, srv, wrapped)
			cancel()

			if err != nil {
				res.Message = "下发失败: " + err.Error()
			} else if !okExec || !strings.Contains(out, "MIGRATE_OK") {
				res.Message = "修改失败: " + truncateRunesHeadTail(out, 220)
			} else {
				res.Success = true
				res.Message = fmt.Sprintf("已备份原配置并切换至 %s (tls=%s)，2 秒后自动重连新面板", newServerAddr, tlsVal)
			}
			results[idx] = res
		}(i, sid)
	}
	wg.Wait()
	return results, nil
}

func uploadTelegramDocument(
	ctx context.Context,
	endpoint, token string,
	chatID int64,
	filename string,
	fileBytes []byte,
	caption string,
) error {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("chat_id", strconv.FormatInt(chatID, 10))
	_ = mw.WriteField("caption", caption)
	part, err := mw.CreateFormFile("document", filename)
	if err != nil {
		return err
	}
	if _, err := part.Write(fileBytes); err != nil {
		return err
	}
	if err := mw.Close(); err != nil {
		return err
	}

	url := fmt.Sprintf("%s/bot%s/sendDocument", strings.TrimRight(endpoint, "/"), token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var res struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	if json.Unmarshal(respBody, &res) == nil && !res.OK {
		return errors.New(res.Description)
	}
	return nil
}

func buildMigrationComposeYAML(listenPort uint) string {
	return fmt.Sprintf(`services:
  dashboard:
    image: nezha-custom:latest
    container_name: nezha-dashboard
    restart: always
    mem_limit: 256m
    environment:
      - TZ=Asia/Shanghai
      - GOGC=50
    volumes:
      - ./data:/dashboard/data
    ports:
      - %d:%d
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
`, listenPort, listenPort)
}

func buildMigrationRestoreScript(listenPort uint, installHost string) string {
	hostHint := installHost
	if hostHint == "" {
		hostHint = fmt.Sprintf("你的域名:%d", listenPort)
	}
	return fmt.Sprintf(`#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-/opt/nezha/dashboard}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=================================================="
echo "  🧳 哪吒定制面板一键迁移恢复脚本"
echo "  目标目录: ${TARGET_DIR}"
echo "=================================================="

mkdir -p "${TARGET_DIR}/data"
cp -f "${SCRIPT_DIR}/data/config.yaml" "${TARGET_DIR}/data/config.yaml"
cp -f "${SCRIPT_DIR}/data/sqlite.db" "${TARGET_DIR}/data/sqlite.db"
chmod 600 "${TARGET_DIR}/data/config.yaml" "${TARGET_DIR}/data/sqlite.db"

if [ -d "${SCRIPT_DIR}/data/tsdb" ]; then
  rm -rf "${TARGET_DIR}/data/tsdb"
  cp -a "${SCRIPT_DIR}/data/tsdb" "${TARGET_DIR}/data/tsdb"
fi

if [ ! -f "${TARGET_DIR}/docker-compose.yaml" ]; then
  cp -f "${SCRIPT_DIR}/docker-compose.yaml" "${TARGET_DIR}/docker-compose.yaml"
fi

# 若同目录存在导出的镜像包 nezha-image.tar.gz，自动导入
if [ -f "${SCRIPT_DIR}/nezha-image.tar.gz" ]; then
  echo "==> 检测到 nezha-image.tar.gz，正在导入定制镜像..."
  docker load -i "${SCRIPT_DIR}/nezha-image.tar.gz"
fi

if ! docker image inspect nezha-custom:latest >/dev/null 2>&1; then
  echo ""
  echo "⚠️  数据已完整还原至 ${TARGET_DIR}/data/，但本机尚未加载定制镜像 nezha-custom:latest！"
  echo "    请选择任意一种方式导入镜像后再启动："
  echo "    1) 从旧机器导出镜像: docker save nezha-custom:latest | gzip > nezha-image.tar.gz"
  echo "       传到新机器后执行: docker load -i nezha-image.tar.gz"
  echo "    2) 或在本地电脑交叉编译并打包部署包上传。"
  echo "    镜像就绪后执行: cd ${TARGET_DIR} && docker compose up -d"
  exit 0
fi

cd "${TARGET_DIR}"
docker compose up -d --force-recreate
echo ""
echo "✅ 面板已成功启动（监听端口 %d）！"
echo "👉 下一步：将域名解析（%s）的 A 记录指向这台新服务器 IP，并配置好反向代理。"
echo "   DNS 生效后，所有旧小鸡上的 nezha-agent 将在 10 秒内自动全部重连，一台无需手动重装！"
`, listenPort, hostHint)
}

func buildMigrationReadme(m BackupManifest) string {
	encNote := "本备份包未加密，可直接用 tar -xzf 解压。"
	if m.Encrypted {
		encNote = `本备份包已使用 AES-256-CBC (PBKDF2-SHA256, 100000 iter) 加密。
在任意 Linux/macOS 服务器解密命令：
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -in 你的备份文件.tar.gz.enc -out nezha-backup.tar.gz
（输入你在面板设置的备份加密密码，随后 tar -xzf nezha-backup.tar.gz 即可）`
	}
	return fmt.Sprintf(`=== 哪吒面板定制版 · 备份与一键搬家说明 ===
站点名称：%s
面板版本：%s
备份时间：%s
纳管小鸡：%d 台
接入地址：%s
监听端口：%d
包含 TSDB：%v

【加密说明】
%s

【场景 A：新服务器一键恢复（不换域名，推荐，全部小鸡自动重连）】
1. 在新服务器把压缩包解压到临时目录：
   mkdir -p /tmp/nezha-restore && tar -xzf nezha-backup.tar.gz -C /tmp/nezha-restore
2. （可选，若旧机器还活着）在旧机器导出你的定制镜像并传到新机器同目录：
   docker save nezha-custom:latest | gzip > nezha-image.tar.gz
3. 在新服务器运行一键恢复脚本：
   bash /tmp/nezha-restore/restore.sh
4. 在 DNS 控制台把 %s 指向新服务器 IP（并配置好反代 / 放行 %d 端口）。
   10 秒内所有十几台小鸡将自动重连上线，无需任何重新配置！

【场景 B：在新面板网页端直接还原】
如果新服务器已经跑起空白的定制版哪吒面板，直接登录后台进入「🧳 备份与搬家」页面，
上传本备份包（支持直接上传 .tar.gz 或加密的 .tar.gz.enc + 输入口令），面板会自动热替换数据并重启生效！
`, m.SiteName, m.Version, m.CreatedAt.Format("2006-01-02 15:04:05"), m.TotalServers, m.InstallHost, m.ListenPort, m.IncludeTSDB, encNote, m.InstallHost, m.ListenPort)
}

func copyFileContents(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0600)
}

func atomicReplaceFile(dst string, data []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0700); err != nil {
		return err
	}
	tmp := dst + ".tmp-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		// Fallback direct write on platforms like Windows when replacing an existing file
		return os.WriteFile(dst, data, perm)
	}
	return nil
}

func copyDirRecursive(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, rErr := filepath.Rel(src, path)
		if rErr != nil {
			return rErr
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		return copyFileContents(path, target)
	})
}

func formatByteSize(n int64) string {
	switch {
	case n >= 1024*1024*1024:
		return fmt.Sprintf("%.2f GB", float64(n)/(1024*1024*1024))
	case n >= 1024*1024:
		return fmt.Sprintf("%.2f MB", float64(n)/(1024*1024))
	case n >= 1024:
		return fmt.Sprintf("%.1f KB", float64(n)/1024)
	default:
		return fmt.Sprintf("%d B", n)
	}
}
