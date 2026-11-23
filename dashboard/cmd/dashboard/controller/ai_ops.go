package controller

import (
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// GET /api/v1/ai-ops/config
func getAIOpsConfig(c *gin.Context) (model.AIOpsConfigView, error) {
	if singleton.AIOpsShared == nil {
		return model.AIOpsConfigView{}, errors.New("AI Ops 服务尚未初始化")
	}
	snap := singleton.AIOpsShared.GetConfigSnapshot()
	return snap.ToView(), nil
}

// PUT /api/v1/ai-ops/config
func updateAIOpsConfig(c *gin.Context) (model.AIOpsConfigView, error) {
	if singleton.AIOpsShared == nil {
		return model.AIOpsConfigView{}, errors.New("AI Ops 服务尚未初始化")
	}
	var form model.AIOpsConfigUpdateForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return model.AIOpsConfigView{}, err
	}
	return singleton.AIOpsShared.UpdateConfig(form)
}

type testAIOpsModelForm struct {
	Tier          string `json:"tier"` // "small" | "large"
	BaseURL       string `json:"base_url"`
	APIKey        string `json:"api_key"`
	Model         string `json:"model"`
	ShareProvider bool   `json:"share_provider"`
}

// POST /api/v1/ai-ops/test-model
func testAIOpsModel(c *gin.Context) (any, error) {
	if singleton.AIOpsShared == nil {
		return nil, errors.New("AI Ops 服务尚未初始化")
	}
	var form testAIOpsModelForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	reply, latencyMs, err := singleton.AIOpsShared.TestModelConnection(
		c.Request.Context(),
		form.Tier,
		form.BaseURL,
		form.APIKey,
		form.Model,
		form.ShareProvider,
	)
	if err != nil {
		return nil, err
	}
	return gin.H{
		"reply":      reply,
		"latency_ms": latencyMs,
	}, nil
}

// GET /api/v1/ai-ops/sessions
func listAIOpsSessions(c *gin.Context) ([]model.AIOpsChatSession, error) {
	if singleton.DB == nil {
		return []model.AIOpsChatSession{}, nil
	}
	var sessions []model.AIOpsChatSession
	if err := singleton.DB.Order("updated_at desc").Limit(50).Find(&sessions).Error; err != nil {
		return nil, err
	}
	return sessions, nil
}

// GET /api/v1/ai-ops/sessions/:id
func getAIOpsSession(c *gin.Context) (any, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		return nil, errors.New("无效的会话 ID")
	}
	var session model.AIOpsChatSession
	if err := singleton.DB.First(&session, id).Error; err != nil {
		return nil, errors.New("会话不存在")
	}
	var messages []model.AIOpsChatMessage
	if err := singleton.DB.Where("session_id = ?", id).Order("id asc").Find(&messages).Error; err != nil {
		return nil, err
	}
	return gin.H{
		"session":  session,
		"messages": messages,
	}, nil
}

// DELETE /api/v1/ai-ops/sessions/:id
func deleteAIOpsSession(c *gin.Context) (any, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		return nil, errors.New("无效的会话 ID")
	}
	if singleton.AIOpsShared != nil {
		singleton.AIOpsShared.CancelSession(id)
	}
	singleton.DB.Where("session_id = ?", id).Delete(&model.AIOpsChatMessage{})
	singleton.DB.Delete(&model.AIOpsChatSession{}, id)
	return gin.H{"deleted": id}, nil
}

// POST /api/v1/ai-ops/sessions/:id/cancel
func cancelAIOpsSession(c *gin.Context) (any, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		return nil, errors.New("无效的会话 ID")
	}
	cancelled := false
	if singleton.AIOpsShared != nil {
		cancelled = singleton.AIOpsShared.CancelSession(id)
	}
	return gin.H{"cancelled": cancelled}, nil
}

type postAIOpsChatForm struct {
	SessionID uint64 `json:"session_id"`
	Prompt    string `json:"prompt"`
	Title     string `json:"title,omitempty"`
}

// POST /api/v1/ai-ops/chat
func postAIOpsChat(c *gin.Context) (any, error) {
	if singleton.AIOpsShared == nil {
		return nil, errors.New("AI Ops 服务尚未初始化")
	}
	var form postAIOpsChatForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	sessID, msgID, err := singleton.AIOpsShared.StartWebChatTurn(form.SessionID, form.Prompt, form.Title)
	if err != nil {
		return nil, err
	}
	return gin.H{
		"session_id": sessID,
		"message_id": msgID,
	}, nil
}

// GET /api/v1/ai-ops/incidents
func listAIOpsIncidents(c *gin.Context) ([]model.AIOpsIncident, error) {
	if singleton.DB == nil {
		return []model.AIOpsIncident{}, nil
	}
	var rows []model.AIOpsIncident
	if err := singleton.DB.Order("id desc").Limit(100).Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// POST /api/v1/ai-ops/patrol-now
func triggerAIOpsPatrolNow(c *gin.Context) (any, error) {
	if singleton.AIOpsShared == nil {
		return nil, errors.New("AI Ops 服务尚未初始化")
	}
	if err := singleton.AIOpsShared.TriggerManualPatrol(); err != nil {
		return nil, err
	}
	return gin.H{"started": true}, nil
}

// DELETE /api/v1/ai-ops/incidents
func clearAIOpsIncidents(c *gin.Context) (any, error) {
	if singleton.DB != nil {
		singleton.DB.Where("1 = 1").Delete(&model.AIOpsIncident{})
	}
	return gin.H{"cleared": true}, nil
}

// POST /api/v1/ai-ops/servers/:id/restore-ssh-keys
func restoreServerSSHKeys(c *gin.Context) (any, error) {
	if singleton.AIOpsShared == nil {
		return nil, errors.New("AI Ops 服务尚未初始化")
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		return nil, errors.New("无效的服务器 ID")
	}
	msg, err := singleton.AIOpsShared.RestorePreviousSSHKeys(c.Request.Context(), id)
	if err != nil {
		return nil, err
	}
	return gin.H{"restored": true, "message": msg}, nil
}
