package singleton

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/nezhahq/nezha/model"
)

type tgUpdateResponse struct {
	OK     bool       `json:"ok"`
	Result []tgUpdate `json:"result"`
}

type tgUpdate struct {
	UpdateID int64      `json:"update_id"`
	Message  *tgMessage `json:"message,omitempty"`
}

type tgMessage struct {
	MessageID int64  `json:"message_id"`
	Text      string `json:"text"`
	Chat      struct {
		ID int64 `json:"id"`
	} `json:"chat"`
	From *struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	} `json:"from,omitempty"`
}

type tgSendResult struct {
	OK     bool `json:"ok"`
	Result struct {
		MessageID int64 `json:"message_id"`
	} `json:"result"`
}

func parseAllowedTelegramIDs(raw string) map[int64]struct{} {
	res := make(map[int64]struct{})
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\t' || r == '，'
	}) {
		p := strings.TrimSpace(part)
		if p == "" {
			continue
		}
		if id, err := strconv.ParseInt(p, 10, 64); err == nil && id != 0 {
			res[id] = struct{}{}
		}
	}
	return res
}

func (ao *AIOpsClass) syncTelegramPoller() {
	cfg := ao.GetConfigSnapshot()
	token := strings.TrimSpace(cfg.TelegramBotToken)
	endpoint := strings.TrimRight(strings.TrimSpace(cfg.TelegramEndpoint), "/")
	if endpoint == "" {
		endpoint = "https://api.telegram.org"
	}
	sig := ""
	if cfg.TelegramEnabled && token != "" {
		sig = endpoint + "|" + token
	}

	ao.tgMu.Lock()
	defer ao.tgMu.Unlock()

	if sig == ao.tgSignature {
		return
	}
	if ao.tgCancel != nil {
		ao.tgCancel()
		ao.tgCancel = nil
	}
	ao.tgSignature = sig
	if sig == "" {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	ao.tgCancel = cancel
	go ao.runTelegramPollLoop(ctx, endpoint, token)
}

func (ao *AIOpsClass) runTelegramPollLoop(ctx context.Context, endpoint, token string) {
	log.Printf("NEZHA>> AI Ops Telegram bot poller started (%s)", endpoint)
	defer log.Printf("NEZHA>> AI Ops Telegram bot poller stopped")

	client := &http.Client{Timeout: 35 * time.Second}
	var offset int64

	// Advance past stale backlog updates from before startup so old messages are never re-executed
	if latest, err := fetchTelegramUpdates(ctx, client, endpoint, token, -1, 0); err == nil && len(latest) > 0 {
		offset = latest[len(latest)-1].UpdateID + 1
	}

	for {
		if ctx.Err() != nil {
			return
		}
		updates, err := fetchTelegramUpdates(ctx, client, endpoint, token, offset, 25)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			select {
			case <-time.After(5 * time.Second):
			case <-ctx.Done():
				return
			}
			continue
		}

		for _, upd := range updates {
			if upd.UpdateID >= offset {
				offset = upd.UpdateID + 1
			}
			if upd.Message == nil || strings.TrimSpace(upd.Message.Text) == "" {
				continue
			}
			msg := upd.Message
			go ao.handleTelegramMessage(ctx, endpoint, token, msg)
		}
	}
}

func fetchTelegramUpdates(ctx context.Context, client *http.Client, endpoint, token string, offset int64, timeoutSec int) ([]tgUpdate, error) {
	url := fmt.Sprintf("%s/bot%s/getUpdates?timeout=%d&allowed_updates=%%5B%%22message%%22%%5D", endpoint, token, timeoutSec)
	if offset != 0 {
		url += fmt.Sprintf("&offset=%d", offset)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("telegram getUpdates HTTP %d", resp.StatusCode)
	}
	var parsed tgUpdateResponse
	if err := json.Unmarshal(body, &parsed); err != nil || !parsed.OK {
		return nil, errors.New("invalid telegram getUpdates payload")
	}
	return parsed.Result, nil
}

func sendTelegramText(ctx context.Context, endpoint, token string, chatID int64, text string) int64 {
	chunks := splitRunes(text, 3800)
	var lastMsgID int64
	client := &http.Client{Timeout: 15 * time.Second}

	for _, chunk := range chunks {
		payload, _ := json.Marshal(map[string]any{
			"chat_id": chatID,
			"text":    chunk,
		})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/bot%s/sendMessage", endpoint, token), bytes.NewReader(payload))
		if err != nil {
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		resp.Body.Close()
		var sr tgSendResult
		if json.Unmarshal(body, &sr) == nil && sr.OK {
			lastMsgID = sr.Result.MessageID
		}
	}
	return lastMsgID
}

func editTelegramText(ctx context.Context, endpoint, token string, chatID, messageID int64, text string) {
	if messageID == 0 {
		return
	}
	runes := []rune(text)
	if len(runes) > 3800 {
		text = string(runes[:3800]) + "…"
	}
	payload, _ := json.Marshal(map[string]any{
		"chat_id":    chatID,
		"message_id": messageID,
		"text":       text,
	})
	client := &http.Client{Timeout: 12 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/bot%s/editMessageText", endpoint, token), bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if resp, err := client.Do(req); err == nil {
		resp.Body.Close()
	}
}

func splitRunes(s string, maxLen int) []string {
	r := []rune(s)
	if len(r) == 0 {
		return []string{"(空响应)"}
	}
	var out []string
	for len(r) > maxLen {
		out = append(out, string(r[:maxLen]))
		r = r[maxLen:]
	}
	if len(r) > 0 {
		out = append(out, string(r))
	}
	return out
}

func (ao *AIOpsClass) broadcastTelegramAdmins(cfg model.AIOpsConfig, text string) {
	allowed := parseAllowedTelegramIDs(cfg.TelegramAllowedChatIDs)
	if len(allowed) == 0 {
		return
	}
	endpoint := strings.TrimRight(strings.TrimSpace(cfg.TelegramEndpoint), "/")
	if endpoint == "" {
		endpoint = "https://api.telegram.org"
	}
	token := strings.TrimSpace(cfg.TelegramBotToken)
	if token == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for chatID := range allowed {
		sendTelegramText(ctx, endpoint, token, chatID, text)
	}
}

func (ao *AIOpsClass) handleTelegramMessage(parentCtx context.Context, endpoint, token string, msg *tgMessage) {
	cfg := ao.GetConfigSnapshot()
	allowed := parseAllowedTelegramIDs(cfg.TelegramAllowedChatIDs)
	chatID := msg.Chat.ID
	var fromID int64
	if msg.From != nil {
		fromID = msg.From.ID
	}

	_, chatOK := allowed[chatID]
	_, fromOK := allowed[fromID]
	if !chatOK && !fromOK {
		sendTelegramText(
			parentCtx,
			endpoint,
			token,
			chatID,
			fmt.Sprintf("🔒 尚未授权此 Telegram 会话操控服务器。\n\n如果你是面板管理员，请复制你的 Chat ID：%d\n填入哪吒管理后台「🤖 AI 运维 → 双模型与 Telegram 配置 → 允许操控的管理员 Chat ID」中保存即可！", chatID),
		)
		return
	}

	text := strings.TrimSpace(msg.Text)
	cmdField := strings.Fields(text)[0]
	if idx := strings.IndexByte(cmdField, '@'); idx > 0 {
		cmdField = cmdField[:idx]
	}

	switch strings.ToLower(cmdField) {
	case "/start", "/help":
		sendTelegramText(parentCtx, endpoint, token, chatID,
			"🤖 你好！我是哪吒探针「AI 运维管家」，无需 SSH 密钥即可帮你巡检与管理全部服务器。\n\n"+
				"📌 快捷命令：\n"+
				"• /status — 秒看全群在线率与高负载小鸡（0 Token）\n"+
				"• /patrol — 立即让 AI 巡检全群健康状态\n"+
				"• /clear — 清空当前对话上下文\n\n"+
				"💬 你也可以直接用自然语言吩咐我干活，例如：\n"+
				"• 「看看现在哪几台服务器内存或硬盘占用最高」\n"+
				"• 「帮我检查香港那台机器上跑了哪些 Docker 容器」\n"+
				"• 「帮我把美西小鸡上的 caddy 容器更新到最新镜像并检查状态」")
		return

	case "/status":
		sendTelegramText(parentCtx, endpoint, token, chatID, buildQuickFleetStatusText())
		return

	case "/patrol":
		if err := ao.TriggerManualPatrol(); err != nil {
			sendTelegramText(parentCtx, endpoint, token, chatID, "⚠️ "+err.Error())
		} else {
			sendTelegramText(parentCtx, endpoint, token, chatID, "🔍 已启动全群 AI 巡检！可在后台「自动盯盘与巡检报告」查看详情，若发现异常我将直接向你汇报。")
		}
		return

	case "/clear":
		if DB != nil {
			src := fmt.Sprintf("telegram:%d", chatID)
			var ids []uint64
			DB.Model(&model.AIOpsChatSession{}).Where("source = ?", src).Pluck("id", &ids)
			if len(ids) > 0 {
				DB.Where("session_id IN ?", ids).Delete(&model.AIOpsChatMessage{})
				DB.Where("id IN ?", ids).Delete(&model.AIOpsChatSession{})
			}
		}
		sendTelegramText(parentCtx, endpoint, token, chatID, "🧹 已清空当前 Telegram 运维对话上下文。")
		return
	}

	// Natural-language autonomous ops execution via High-Tier Model!
	baseURL, apiKey, modelName := cfg.EffectiveLargeEndpoint()
	if baseURL == "" || apiKey == "" || modelName == "" {
		sendTelegramText(parentCtx, endpoint, token, chatID, "⚠️ 面板尚未配置高级模型 API 参数，请先在后台「🤖 AI 运维 → 设置」中填写。")
		return
	}

	statusMsgID := sendTelegramText(parentCtx, endpoint, token, chatID, fmt.Sprintf("⏳ 收到指令，正在唤醒 [%s] 连接 Agent 执行...", modelName))

	// Load or create session for this Telegram chat so Web UI also shows full audit trail
	src := fmt.Sprintf("telegram:%d", chatID)
	var session model.AIOpsChatSession
	var history []llmChatMessage
	if DB != nil {
		if err := DB.Where("source = ?", src).Order("id desc").First(&session).Error; err != nil {
			session = model.AIOpsChatSession{
				Title:  fmt.Sprintf("TG 遥控 (%d)", chatID),
				Source: src,
			}
			_ = DB.Create(&session).Error
		}
		var prev []model.AIOpsChatMessage
		DB.Where("session_id = ? AND status = ?", session.ID, "done").Order("id desc").Limit(8).Find(&prev)
		for i := len(prev) - 1; i >= 0; i-- {
			history = append(history, llmChatMessage{Role: prev[i].Role, Content: prev[i].Content})
		}
		_ = DB.Create(&model.AIOpsChatMessage{
			SessionID: session.ID,
			Role:      "user",
			Content:   text,
			Status:    "done",
		}).Error
	}
	history = append(history, llmChatMessage{Role: "user", Content: text})

	runCtx, cancel := context.WithTimeout(parentCtx, 5*time.Minute)
	defer cancel()

	var lastEdit time.Time
	replyText, steps, runErr := ao.runAgentReActLoop(
		runCtx,
		baseURL,
		apiKey,
		modelName,
		history,
		false,
		func(curSteps []model.AIOpsToolStep, hint string) {
			if time.Since(lastEdit) >= 2500*time.Millisecond {
				lastEdit = time.Now()
				editTelegramText(runCtx, endpoint, token, chatID, statusMsgID,
					fmt.Sprintf("⚡ [%s] 正在执行第 %d 步：%s", modelName, len(curSteps)+1, hint))
			}
		},
	)

	if DB != nil && session.ID > 0 {
		stepsBytes, _ := json.Marshal(steps)
		st := "done"
		contentToSave := replyText
		if runErr != nil {
			st = "error"
			contentToSave = "❌ " + runErr.Error()
		}
		_ = DB.Create(&model.AIOpsChatMessage{
			SessionID:     session.ID,
			Role:          "assistant",
			Content:       contentToSave,
			ModelUsed:     modelName,
			Status:        st,
			ToolStepsJSON: string(stepsBytes),
		}).Error
		_ = DB.Model(&session).Update("updated_at", time.Now()).Error
	}

	if runErr != nil {
		editTelegramText(parentCtx, endpoint, token, chatID, statusMsgID, "❌ 执行出错："+runErr.Error())
		return
	}

	finalOut := fmt.Sprintf("✅ [%s · 共执行 %d 步]\n\n%s", modelName, len(steps), replyText)
	chunks := splitRunes(finalOut, 3800)
	if len(chunks) == 1 && statusMsgID > 0 {
		editTelegramText(parentCtx, endpoint, token, chatID, statusMsgID, chunks[0])
	} else {
		if statusMsgID > 0 {
			editTelegramText(parentCtx, endpoint, token, chatID, statusMsgID, chunks[0])
			for _, extra := range chunks[1:] {
				sendTelegramText(parentCtx, endpoint, token, chatID, extra)
			}
		} else {
			sendTelegramText(parentCtx, endpoint, token, chatID, finalOut)
		}
	}
}

func buildQuickFleetStatusText() string {
	if ServerShared == nil {
		return "服务器注册表尚未就绪。"
	}
	now := time.Now()
	var briefs []aiServerBrief
	onlineCount := 0
	var offlineNames []string
	for _, srv := range ServerShared.Range {
		if srv == nil {
			continue
		}
		b := buildServerBrief(srv, now)
		briefs = append(briefs, b)
		if b.Online {
			onlineCount++
		} else {
			offlineNames = append(offlineNames, fmt.Sprintf("%s (#%d)", b.Name, b.ID))
		}
	}
	slices.SortFunc(briefs, func(a, b aiServerBrief) int {
		if a.CPUPct > b.CPUPct {
			return -1
		}
		if a.CPUPct < b.CPUPct {
			return 1
		}
		return 0
	})

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("📊 服务器集群实时总览\n• 在线状态：%d / %d 台在线\n", onlineCount, len(briefs)))
	if len(offlineNames) > 0 {
		sb.WriteString(fmt.Sprintf("• 🔴 离线机器：%s\n", strings.Join(offlineNames, "、")))
	}
	sb.WriteString("\n🔥 当前 CPU 占用前 5 节点：\n")
	limit := 5
	if len(briefs) < limit {
		limit = len(briefs)
	}
	for i := 0; i < limit; i++ {
		b := briefs[i]
		statusDot := "🟢"
		if !b.Online {
			statusDot = "🔴"
		}
		sb.WriteString(fmt.Sprintf("%s %s: CPU %.1f%% | 内存 %.1f%% | 硬盘 %.1f%%\n",
			statusDot, b.Name, b.CPUPct, b.MemPct, b.DiskPct))
	}
	return sb.String()
}
