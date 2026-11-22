package controller

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// GET /api/v1/backup/config
func getBackupConfig(c *gin.Context) (model.BackupConfigView, error) {
	if singleton.BackupShared == nil {
		return model.BackupConfigView{}, errors.New("备份服务尚未初始化")
	}
	return singleton.BackupShared.GetConfigView(), nil
}

// PUT /api/v1/backup/config
func updateBackupConfig(c *gin.Context) (model.BackupConfigView, error) {
	if singleton.BackupShared == nil {
		return model.BackupConfigView{}, errors.New("备份服务尚未初始化")
	}
	var form model.BackupConfigUpdateForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return model.BackupConfigView{}, err
	}
	return singleton.BackupShared.UpdateConfig(form)
}

type exportBackupForm struct {
	IncludeTSDB      bool   `json:"include_tsdb"`
	EncryptPassword  string `json:"encrypt_password"`
	UseSavedPassword bool   `json:"use_saved_password"`
}

// POST /api/v1/backup/export
func exportBackupArchive(c *gin.Context) (any, error) {
	if singleton.BackupShared == nil {
		return nil, errors.New("备份服务尚未初始化")
	}
	var form exportBackupForm
	_ = c.ShouldBindJSON(&form)

	passphrase := strings.TrimSpace(form.EncryptPassword)
	if form.UseSavedPassword && passphrase == "" {
		passphrase = singleton.BackupShared.GetConfigSnapshot().EncryptPassword
	}

	data, filename, _, _, err := singleton.BackupShared.CreateBackupArchive(form.IncludeTSDB, passphrase)
	if err != nil {
		return nil, err
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Header("X-Backup-Filename", filename)
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "application/octet-stream", data)
	return nil, errNoop
}

// POST /api/v1/backup/telegram-now
func triggerTelegramBackupNow(c *gin.Context) (model.BackupConfigView, error) {
	if singleton.BackupShared == nil {
		return model.BackupConfigView{}, errors.New("备份服务尚未初始化")
	}
	return singleton.BackupShared.SendBackupToTelegram(c.Request.Context(), true)
}

// POST /api/v1/backup/restore
func restoreBackupArchive(c *gin.Context) (any, error) {
	if singleton.BackupShared == nil {
		return nil, errors.New("备份服务尚未初始化")
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return nil, errors.New("请先选择要导入还原的备份文件（.tar.gz 或 .tar.gz.enc）")
	}
	if fh.Size <= 0 {
		return nil, errors.New("上传的备份文件为空")
	}
	if fh.Size > 256*1024*1024 {
		return nil, errors.New("单次网页上传备份限制最大 256 MB，超大文件请通过服务器 restore.sh 还原")
	}
	f, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()

	raw, err := io.ReadAll(io.LimitReader(f, 256*1024*1024+1))
	if err != nil {
		return nil, err
	}
	passphrase := c.PostForm("password")
	preDir, mf, err := singleton.BackupShared.RestoreFromArchive(raw, passphrase)
	if err != nil {
		return nil, err
	}
	return gin.H{
		"restored":       true,
		"restarting":     true,
		"pre_backup_dir": preDir,
		"manifest":       mf,
		"message":        "备份已校验并安全写入（原数据已备份到 " + preDir + "），面板将在 2 秒内自动重启加载新数据，请 5 秒后刷新页面！",
	}, nil
}

type batchMigrateAgentsForm struct {
	ServerIDs []uint64 `json:"server_ids"`
	NewServer string   `json:"new_server"`
	UseTLS    bool     `json:"use_tls"`
}

// POST /api/v1/backup/migrate-agents
func batchMigrateAgents(c *gin.Context) (any, error) {
	if singleton.BackupShared == nil {
		return nil, errors.New("备份服务尚未初始化")
	}
	var form batchMigrateAgentsForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	results, err := singleton.BackupShared.BatchMigrateAgentEndpoint(
		c.Request.Context(),
		form.ServerIDs,
		form.NewServer,
		form.UseTLS,
	)
	if err != nil {
		return nil, err
	}
	return gin.H{"results": results}, nil
}
