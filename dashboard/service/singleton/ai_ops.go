package singleton

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
)

var AIOpsShared *AIOpsClass

const (
	aiOpsTaskIDMask      uint64 = uint64(1) << 61
	aiOpsMaxReActSteps          = 25
	aiOpsPatrolSnapshotSh       = `export LC_ALL=C; echo "=== UPTIME ==="; uptime 2>/dev/null; echo "=== MEMORY (MB) ==="; free -m 2>/dev/null; echo "=== DISK ==="; df -hT -x tmpfs -x devtmpfs 2>/dev/null | head -n 12; echo "=== TOP CPU PROCS ==="; ps -eo pid,user,%cpu,%mem,comm,args --sort=-%cpu 2>/dev/null | head -n 10; if command -v docker >/dev/null 2>&1; then echo "=== DOCKER PS ==="; docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" 2>/dev/null | head -n 15; fi`
)

type pendingAIOpsTask struct {
	serverID uint64
	ch       chan *pb.TaskResult
}

type activeChatRun struct {
	cancel    context.CancelFunc
	messageID uint64
}

type AIOpsClass struct {
	cfgMu sync.RWMutex
	cfg   model.AIOpsConfig

	pendingMu sync.Mutex
	pending   map[uint64]*pendingAIOpsTask
	taskSeq   atomic.Uint64

	sessionMu      sync.Mutex
	activeSessions map[uint64]*activeChatRun

	sentinelMu     sync.Mutex
	lastTickAt     time.Time
	anomalyStreak  map[string]int
	cooldownUntil  map[string]time.Time
	everSeenOnline map[uint64]time.Time
	patrolRunning  atomic.Bool

	securityMu           sync.Mutex
	lastSecuritySweepAt  time.Time
	securityStates       map[uint64]*serverSecurityState
	securityCooldown     map[string]time.Time
	securitySweepRunning atomic.Bool

	tgMu        sync.Mutex
	tgCancel    context.CancelFunc
	tgSignature string
}

func defaultAIOpsConfig() model.AIOpsConfig {
	return model.AIOpsConfig{
		ID:                   1,
		Enabled:              false,
		SmallBaseURL:         "https://api.deepseek.com/v1",
		SmallModel:           "deepseek-chat",
		ShareProvider:        true,
		LargeBaseURL:         "",
		LargeModel:           "deepseek-reasoner",
		PatrolIntervalMin:    3,
		CPUThreshold:         88,
		MemThreshold:         90,
		DiskThreshold:        88,
		CooldownMin:          60,
		AutoSelfHeal:         false,
		TelegramEndpoint:     "https://api.telegram.org",
		SecurityBootstrapped:     true,
		SecurityAutoBootstrapped: true,
		SecurityEnabled:          true,
		SecurityAutoRespond:      true,
		SecurityIntervalMin:      2,
		OutboundSpikeMbps:        50,
		ConnSpikeThreshold:       1200,
	}
}

func NewAIOpsClass() *AIOpsClass {
	ao := &AIOpsClass{
		cfg:              defaultAIOpsConfig(),
		pending:          make(map[uint64]*pendingAIOpsTask),
		activeSessions:   make(map[uint64]*activeChatRun),
		anomalyStreak:    make(map[string]int),
		cooldownUntil:    make(map[string]time.Time),
		everSeenOnline:   make(map[uint64]time.Time),
		securityStates:   make(map[uint64]*serverSecurityState),
		securityCooldown: make(map[string]time.Time),
	}
	ao.taskSeq.Store(uint64(time.Now().UnixNano() & 0x0fffffff))
	ao.loadConfigFromDB()
	if DB != nil {
		// Clean up any zombie 'running' chat messages or incidents left behind by a container restart
		_ = DB.Model(&model.AIOpsChatMessage{}).Where("status = ?", "running").Updates(map[string]any{
			"status":  "error",
			"content": "⚠️ 面板服务刚刚重启，未完成的后台任务已安全中断，可点击下方「继续完成」接着处理。",
		}).Error
		_ = DB.Model(&model.AIOpsIncident{}).Where("status IN ?", []string{"triaging", "diagnosing"}).Updates(map[string]any{
			"status":       "error",
			"large_report": "面板重启中断了本次巡检。",
		}).Error
	}
	return ao
}

func (ao *AIOpsClass) loadConfigFromDB() {
	if DB == nil {
		return
	}
	var row model.AIOpsConfig
	if err := DB.First(&row, 1).Error; err != nil {
		def := defaultAIOpsConfig()
		_ = DB.Create(&def).Error
		ao.cfgMu.Lock()
		ao.cfg = def
		ao.cfgMu.Unlock()
		return
	}
	if row.PatrolIntervalMin < 1 {
		row.PatrolIntervalMin = 3
	}
	if row.CPUThreshold <= 0 {
		row.CPUThreshold = 88
	}
	if row.MemThreshold <= 0 {
		row.MemThreshold = 90
	}
	if row.DiskThreshold <= 0 {
		row.DiskThreshold = 88
	}
	if row.CooldownMin < 5 {
		row.CooldownMin = 60
	}
	if strings.TrimSpace(row.TelegramEndpoint) == "" {
		row.TelegramEndpoint = "https://api.telegram.org"
	}
	if !row.SecurityBootstrapped {
		row.SecurityEnabled = true
		row.SecurityIntervalMin = 2
		row.OutboundSpikeMbps = 50
		row.ConnSpikeThreshold = 1200
		row.SecurityBootstrapped = true
		_ = DB.Save(&row).Error
	}
	if !row.SecurityAutoBootstrapped {
		row.SecurityAutoRespond = true
		if row.SecurityIntervalMin >= 5 {
			row.SecurityIntervalMin = 2
		}
		row.SecurityAutoBootstrapped = true
		_ = DB.Save(&row).Error
	}
	if row.SecurityIntervalMin < 1 {
		row.SecurityIntervalMin = 2
	}
	if row.OutboundSpikeMbps <= 0 {
		row.OutboundSpikeMbps = 50
	}
	if row.ConnSpikeThreshold < 100 {
		row.ConnSpikeThreshold = 1200
	}
	ao.cfgMu.Lock()
	ao.cfg = row
	ao.cfgMu.Unlock()
}

func (ao *AIOpsClass) StartBackgroundWorkers() {
	ao.syncTelegramPoller()
	// Warm up security fingerprint baseline 35s after startup once agents reconnect
	go func() {
		time.Sleep(35 * time.Second)
		cfg := ao.GetConfigSnapshot()
		if cfg.Enabled && cfg.SecurityEnabled {
			ao.securityMu.Lock()
			ao.lastSecuritySweepAt = time.Now()
			ao.securityMu.Unlock()
			ao.runSecurityFingerprintSweep(cfg)
		}
	}()
}

func (ao *AIOpsClass) GetConfigSnapshot() model.AIOpsConfig {
	ao.cfgMu.RLock()
	defer ao.cfgMu.RUnlock()
	return ao.cfg
}

func (ao *AIOpsClass) UpdateConfig(form model.AIOpsConfigUpdateForm) (model.AIOpsConfigView, error) {
	ao.cfgMu.Lock()
	next := ao.cfg

	next.ID = 1
	next.Enabled = form.Enabled
	next.SmallBaseURL = strings.TrimSpace(form.SmallBaseURL)
	next.SmallModel = strings.TrimSpace(form.SmallModel)
	next.ShareProvider = form.ShareProvider
	next.LargeBaseURL = strings.TrimSpace(form.LargeBaseURL)
	next.LargeModel = strings.TrimSpace(form.LargeModel)

	if form.SmallAPIKey == "__CLEAR__" {
		next.SmallAPIKey = ""
	} else if !model.IsMaskedUnchanged(form.SmallAPIKey, next.SmallAPIKey) {
		next.SmallAPIKey = strings.TrimSpace(form.SmallAPIKey)
	}

	if form.LargeAPIKey == "__CLEAR__" {
		next.LargeAPIKey = ""
	} else if !model.IsMaskedUnchanged(form.LargeAPIKey, next.LargeAPIKey) {
		next.LargeAPIKey = strings.TrimSpace(form.LargeAPIKey)
	}

	if form.PatrolIntervalMin >= 1 && form.PatrolIntervalMin <= 1440 {
		next.PatrolIntervalMin = form.PatrolIntervalMin
	} else if next.PatrolIntervalMin < 1 {
		next.PatrolIntervalMin = 3
	}
	if form.CPUThreshold >= 20 && form.CPUThreshold <= 100 {
		next.CPUThreshold = form.CPUThreshold
	}
	if form.MemThreshold >= 20 && form.MemThreshold <= 100 {
		next.MemThreshold = form.MemThreshold
	}
	if form.DiskThreshold >= 20 && form.DiskThreshold <= 100 {
		next.DiskThreshold = form.DiskThreshold
	}
	if form.CooldownMin >= 5 && form.CooldownMin <= 1440 {
		next.CooldownMin = form.CooldownMin
	}
	next.AutoSelfHeal = form.AutoSelfHeal
	next.NotificationGroupID = form.NotificationGroupID

	next.TelegramEnabled = form.TelegramEnabled
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
	next.TelegramAllowedChatIDs = strings.TrimSpace(form.TelegramAllowedChatIDs)

	next.SecurityBootstrapped = true
	next.SecurityAutoBootstrapped = true
	next.SecurityEnabled = form.SecurityEnabled
	next.SecurityAutoRespond = form.SecurityAutoRespond
	if form.SecurityIntervalMin >= 1 && form.SecurityIntervalMin <= 1440 {
		next.SecurityIntervalMin = form.SecurityIntervalMin
	} else if next.SecurityIntervalMin < 1 {
		next.SecurityIntervalMin = 2
	}
	next.TrustedSSHIPS = strings.TrimSpace(form.TrustedSSHIPS)
	if form.OutboundSpikeMbps >= 5 && form.OutboundSpikeMbps <= 100000 {
		next.OutboundSpikeMbps = form.OutboundSpikeMbps
	} else if next.OutboundSpikeMbps <= 0 {
		next.OutboundSpikeMbps = 50
	}
	if form.ConnSpikeThreshold >= 100 && form.ConnSpikeThreshold <= 1000000 {
		next.ConnSpikeThreshold = form.ConnSpikeThreshold
	} else if next.ConnSpikeThreshold < 100 {
		next.ConnSpikeThreshold = 1200
	}

	if DB != nil {
		if err := DB.Save(&next).Error; err != nil {
			ao.cfgMu.Unlock()
			return model.AIOpsConfigView{}, err
		}
	}
	ao.cfg = next
	view := next.ToView()
	ao.cfgMu.Unlock()

	ao.syncTelegramPoller()
	return view, nil
}

// HandleCommandResult intercepts TaskTypeCommand responses belonging to AIOps tasks.
func (ao *AIOpsClass) HandleCommandResult(clientID uint64, result *pb.TaskResult) bool {
	if result == nil {
		return false
	}
	taskID := result.GetId()
	if taskID&aiOpsTaskIDMask == 0 {
		return false
	}
	ao.pendingMu.Lock()
	entry, ok := ao.pending[taskID]
	if ok && entry.serverID != clientID {
		ao.pendingMu.Unlock()
		log.Printf("NEZHA>> AIOps result rejected: clientID=%d spoofed taskID=%d owned by server %d", clientID, taskID, entry.serverID)
		return true
	}
	if ok {
		delete(ao.pending, taskID)
	}
	ao.pendingMu.Unlock()

	if ok {
		select {
		case entry.ch <- result:
		default:
		}
	}
	return true
}

// DispatchAgentCommand sends a shell command over the persistent nezha-agent gRPC stream (zero SSH keys needed).
func (ao *AIOpsClass) DispatchAgentCommand(ctx context.Context, server *model.Server, command string) (string, bool, error) {
	if server == nil || server.GetTaskStream() == nil {
		return "", false, errors.New("目标服务器 Agent 当前离线，无法下发命令")
	}
	taskID := aiOpsTaskIDMask | (ao.taskSeq.Add(1) & ((uint64(1) << 59) - 1))
	ch := make(chan *pb.TaskResult, 1)

	ao.pendingMu.Lock()
	ao.pending[taskID] = &pendingAIOpsTask{
		serverID: server.ID,
		ch:       ch,
	}
	ao.pendingMu.Unlock()

	defer func() {
		ao.pendingMu.Lock()
		delete(ao.pending, taskID)
		ao.pendingMu.Unlock()
	}()

	if err := server.SendTask(&pb.Task{
		Id:   taskID,
		Type: model.TaskTypeCommand,
		Data: command,
	}); err != nil {
		return "", false, fmt.Errorf("下发 Agent 指令失败: %w", err)
	}

	select {
	case res := <-ch:
		if res == nil {
			return "", false, errors.New("Agent 返回空响应")
		}
		if !res.GetSuccessful() && strings.TrimSpace(res.GetData()) == "" {
			return "", false, errors.New("Agent 拒绝或执行命令失败（请确认该小鸡 Agent 未开启 disable_command_execute）")
		}
		return res.GetData(), res.GetSuccessful(), nil
	case <-ctx.Done():
		return "", false, fmt.Errorf("等待 Agent 命令执行超时 (%v)", ctx.Err())
	}
}

func buildOpsSystemPrompt(readOnly bool) string {
	nowStr := time.Now().Format("2006-01-02 15:04:05")
	if readOnly {
		return fmt.Sprintf(`你是哪吒探针内置的「高级 AI 运维诊断专家」（当前时间：%s）。
你可以通过内置工具直接连接受控服务器的 nezha-agent 执行只读排查命令（无需 SSH 密钥）。
【诊断准则】：
1. 当前处于「后台只读诊断模式」，请只执行安全的查询/排查类命令（如 ps, top -bn1, free -m, df -h, du -xhd1, ss -tunlp, docker ps -a, docker logs --tail 60, journalctl -n 50, dmesg | tail）。
2. 请顺藤摸瓜找出导致异常的具体进程、Docker 容器或日志文件，不要泛泛而谈。
3. 输出精炼清晰的中文 Markdown 诊断报告，包含：【故障根因】、【关键现场证据】、【建议处理命令】。`, nowStr)
	}

	return fmt.Sprintf(`你是哪吒探针内置的「全自动高级 AI 运维管家」（当前时间：%s）。
你可以直接通过内置工具 list_servers、get_server_detail、exec_on_server 操控用户纳管的所有服务器（底层走 nezha-agent gRPC 加密通道，无需任何 SSH 密钥）。

【全自动执行准则（极其重要）】：
1. 用户已授权你「一口气全自动完成任务并汇报结果」——当用户要求你排查故障、重启服务、清理空间或升级某个 Docker 容器时，请直接自己调用工具一步步做完，不要停下来反问用户要权限或贴命令让用户自己去敲！
2. 【容器升级铁律】：升级任何 Docker 容器前，必须先执行探路命令检查它是如何部署的（例如查看 docker inspect <容器名> 中的 com.docker.compose.project.working_dir 标签、挂载卷、端口映射和原镜像标签）：
   - 若是由 docker compose / docker-compose 启动的：必须 cd 到其原 working_dir 执行 docker compose pull <服务名> && docker compose up -d <服务名>，严禁盲目 docker rm 导致配置丢失！
   - 若是独立 docker run 启动的：务必先完整读取它的端口、环境变量、挂载目录和重启策略后再拉取新镜像重建。
   - 升级完成后，必须执行 docker ps 和 docker logs --tail 25 确认新容器处于 Up 健康状态，再向用户汇报新旧状态对比。
3. 【安全底线】：严禁停止/重启/删除 nezha-agent 自身进程（否则会切断你与该机器的控制连接！），严禁执行删根、格式化磁盘、断网或关机指令。禁止执行无退出条件的交互式命令（如不带 -bn1 的 top、vim、tail -f）。
4. 【分批小步快跑（防思考超长截断）】：同时操作多台服务器或多个容器时，严禁把所有规划一次性写在冗长的思考过程里！请简短思考后立即分批调用 exec_on_server（每次先更新 1~2 个容器并立即检查健康状态，再继续下一批），不要空想不干活。
5. 回复请使用简洁明了的中文 Markdown，总结你做了哪些操作、结果如何。`, nowStr)
}

// runAgentReActLoop executes the multi-step LLM + Agent tool loop with the default ops system prompt.
func (ao *AIOpsClass) runAgentReActLoop(
	ctx context.Context,
	baseURL, apiKey, modelName string,
	history []llmChatMessage,
	readOnly bool,
	onStep func(steps []model.AIOpsToolStep, statusHint string),
) (finalText string, steps []model.AIOpsToolStep, err error) {
	return ao.runAgentReActLoopWithSystem(ctx, baseURL, apiKey, modelName, buildOpsSystemPrompt(readOnly), history, readOnly, onStep)
}

func (ao *AIOpsClass) runAgentReActLoopWithSystem(
	ctx context.Context,
	baseURL, apiKey, modelName string,
	systemPrompt string,
	history []llmChatMessage,
	readOnly bool,
	onStep func(steps []model.AIOpsToolStep, statusHint string),
) (finalText string, steps []model.AIOpsToolStep, err error) {
	tools := buildAIOpsToolDefinitions(readOnly)
	messages := make([]llmChatMessage, 0, len(history)+8)
	messages = append(messages, llmChatMessage{
		Role:    "system",
		Content: systemPrompt,
	})
	messages = append(messages, history...)

	truncationRetries := 0
	for iter := 0; iter < aiOpsMaxReActSteps; iter++ {
		if ctx.Err() != nil {
			return "", steps, ctx.Err()
		}
		reply, callErr := callOpenAICompatible(ctx, baseURL, apiKey, modelName, messages, tools, 16384)
		if callErr != nil {
			return "", steps, callErr
		}

		if len(reply.ToolCalls) == 0 {
			text, _ := reply.Content.(string)
			trimmed := strings.TrimSpace(text)

			// Detect reasoning-model <thinking> truncation or empty reply when finish_reason == "length":
			// NEVER falsely report "✅ 操作已完成。" when the model got cut off before emitting tool calls!
			if reply.RawHadUnclosedThink || trimmed == "" {
				if truncationRetries < 2 {
					truncationRetries++
					if onStep != nil {
						onStep(steps, "检测到模型思考过长被截断，正在自动切换为精简分批模式继续执行...")
					}
					messages = append(messages,
						llmChatMessage{
							Role:    "assistant",
							Content: "收到，我将简短思考并分批调用工具推进。",
						},
						llmChatMessage{
							Role:    "user",
							Content: "你上一条内部思考过长导致输出被截断，未能发出工具调用或最终汇报。请严禁长篇内心思考，立刻调用 exec_on_server 分批执行剩余操作（每次只改 1~2 个服务即可），若全部已完成则直接输出简明中文结果对比。",
						},
					)
					continue
				}
				return "", steps, errors.New("模型单次思考内容过长导致输出被截断（未发出实际命令或最终汇报）")
			}

			messages = append(messages, reply)
			if reply.FinishReason == "length" {
				trimmed += "\n\n> ⚠️ 本条回复触及单次输出长度上限，若末尾未展示完整可继续追问。"
			}
			return trimmed, steps, nil
		}

		messages = append(messages, reply)

		nCalls := len(reply.ToolCalls)
		if nCalls == 1 {
			tc := reply.ToolCalls[0]
			if ctx.Err() != nil {
				return "", steps, ctx.Err()
			}
			if onStep != nil {
				onStep(steps, fmt.Sprintf("正在调用工具 `%s`...", tc.Function.Name))
			}
			out, stepRecord := ao.executeToolCall(ctx, tc, readOnly)
			steps = append(steps, stepRecord)
			if onStep != nil {
				onStep(steps, stepRecord.Summary)
			}
			messages = append(messages, llmChatMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Content:    out,
			})
		} else {
			if ctx.Err() != nil {
				return "", steps, ctx.Err()
			}
			if onStep != nil {
				onStep(steps, fmt.Sprintf("正在跨节点并行执行 %d 项操作...", nCalls))
			}
			outs := make([]string, nCalls)
			recs := make([]model.AIOpsToolStep, nCalls)
			var wg sync.WaitGroup
			for i, tc := range reply.ToolCalls {
				wg.Add(1)
				go func(idx int, call llmToolCall) {
					defer wg.Done()
					outs[idx], recs[idx] = ao.executeToolCall(ctx, call, readOnly)
				}(i, tc)
			}
			wg.Wait()
			for i, tc := range reply.ToolCalls {
				steps = append(steps, recs[i])
				messages = append(messages, llmChatMessage{
					Role:       "tool",
					ToolCallID: tc.ID,
					Content:    outs[i],
				})
			}
			if onStep != nil {
				onStep(steps, recs[nCalls-1].Summary)
			}
		}
	}

	// Reached max tool steps: ask model to summarize findings without tools
	messages = append(messages, llmChatMessage{
		Role:    "user",
		Content: "工具调用步数已达上限，请根据以上已获取的信息直接向管理员输出总结汇报。",
	})
	finalReply, callErr := callOpenAICompatible(ctx, baseURL, apiKey, modelName, messages, nil, 8192)
	if callErr != nil {
		return "", steps, callErr
	}
	text, _ := finalReply.Content.(string)
	if strings.TrimSpace(text) == "" {
		return "", steps, errors.New("工具步数达上限且总结回复被截断，请点击下方按钮继续")
	}
	return text, steps, nil
}

func truncateRunesHeadTail(s string, maxRunes int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= maxRunes || maxRunes < 20 {
		return string(r)
	}
	half := maxRunes / 2
	return string(r[:half]) + " ... " + string(r[len(r)-half:])
}

func buildInterruptedStepSummary(m model.AIOpsChatMessage) string {
	var parsed []model.AIOpsToolStep
	if m.ToolStepsJSON != "" {
		_ = json.Unmarshal([]byte(m.ToolStepsJSON), &parsed)
	}
	if len(parsed) == 0 {
		return m.Content
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("【系统记录：上一轮执行在中途中断（%s），中断前已实际完成以下 %d 步操作，后续若继续处理请直接复用已有备份目录或已拉取镜像，避免重复耗时】：\n", m.Content, len(parsed)))
	for i, st := range parsed {
		cmdShort := truncateRunesHeadTail(st.Command, 160)
		outShort := truncateRunesHeadTail(st.Output, 360)
		sb.WriteString(fmt.Sprintf("%d. [%s] %s (cmd: %s) -> %s\n", i+1, st.ServerName, st.Summary, cmdShort, outShort))
	}
	return sb.String()
}

func appendCoalescedHistory(history []llmChatMessage, role, content string) []llmChatMessage {
	content = strings.TrimSpace(content)
	if content == "" {
		return history
	}
	if len(history) > 0 && history[len(history)-1].Role == role {
		prev, _ := history[len(history)-1].Content.(string)
		history[len(history)-1].Content = prev + "\n\n" + content
		return history
	}
	return append(history, llmChatMessage{
		Role:    role,
		Content: content,
	})
}

// StartWebChatTurn creates/appends a user turn and launches the async ReAct worker for live UI polling.
func (ao *AIOpsClass) StartWebChatTurn(sessionID uint64, prompt string, customTitle string) (uint64, uint64, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return 0, 0, errors.New("请输入指令内容")
	}
	if DB == nil {
		return 0, 0, errors.New("数据库未就绪")
	}

	cfg := ao.GetConfigSnapshot()
	baseURL, apiKey, modelName := cfg.EffectiveLargeEndpoint()
	if strings.TrimSpace(apiKey) == "" || strings.TrimSpace(baseURL) == "" || strings.TrimSpace(modelName) == "" {
		return 0, 0, errors.New("请先在「⚙️ 双模型与 Telegram 配置」中填好 API 地址、密钥与模型名称")
	}

	var session model.AIOpsChatSession
	if sessionID > 0 {
		if err := DB.First(&session, sessionID).Error; err != nil {
			return 0, 0, errors.New("会话不存在")
		}
	} else {
		title := strings.TrimSpace(customTitle)
		if title == "" {
			title = prompt
		}
		runes := []rune(title)
		if len(runes) > 24 {
			title = string(runes[:24]) + "…"
		}
		session = model.AIOpsChatSession{
			Title:  title,
			Source: "web",
		}
		if err := DB.Create(&session).Error; err != nil {
			return 0, 0, err
		}
		ao.pruneOldSessions()
	}

	ao.sessionMu.Lock()
	if _, busy := ao.activeSessions[session.ID]; busy {
		ao.sessionMu.Unlock()
		return 0, 0, errors.New("当前对话正在执行任务中，请等待完成或点击停止")
	}

	// Load prior messages (including interrupted turns so AI remembers backups/pulls already done!)
	var prevMsgs []model.AIOpsChatMessage
	DB.Where("session_id = ? AND status IN ?", session.ID, []string{"done", "error", "cancelled"}).Order("id desc").Limit(16).Find(&prevMsgs)
	history := make([]llmChatMessage, 0, len(prevMsgs)+1)
	for i := len(prevMsgs) - 1; i >= 0; i-- {
		m := prevMsgs[i]
		if m.Role == "user" {
			history = appendCoalescedHistory(history, "user", m.Content)
		} else if m.Role == "assistant" {
			if m.Status == "done" {
				cleaned := stripReasoningBlocks(m.Content)
				if cleaned != "" {
					history = appendCoalescedHistory(history, "assistant", cleaned)
				} else {
					history = appendCoalescedHistory(history, "assistant", buildInterruptedStepSummary(m))
				}
			} else {
				history = appendCoalescedHistory(history, "assistant", buildInterruptedStepSummary(m))
			}
		}
	}
	history = appendCoalescedHistory(history, "user", prompt)

	userMsg := model.AIOpsChatMessage{
		SessionID: session.ID,
		Role:      "user",
		Content:   prompt,
		Status:    "done",
	}
	if err := DB.Create(&userMsg).Error; err != nil {
		ao.sessionMu.Unlock()
		return 0, 0, err
	}

	assistantMsg := model.AIOpsChatMessage{
		SessionID: session.ID,
		Role:      "assistant",
		Content:   "⏳ 正在唤醒高级模型分析任务...",
		ModelUsed: modelName,
		Status:    "running",
	}
	if err := DB.Create(&assistantMsg).Error; err != nil {
		ao.sessionMu.Unlock()
		return 0, 0, err
	}
	DB.Model(&session).Update("updated_at", time.Now())

	// Allow up to 25 minutes for multi-server backups + large Docker image pulls & upgrades
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
	ao.activeSessions[session.ID] = &activeChatRun{
		cancel:    cancel,
		messageID: assistantMsg.ID,
	}
	ao.sessionMu.Unlock()

	go func(sessID, msgID uint64) {
		defer func() {
			cancel()
			ao.sessionMu.Lock()
			delete(ao.activeSessions, sessID)
			ao.sessionMu.Unlock()
		}()

		finalText, steps, runErr := ao.runAgentReActLoop(
			ctx,
			baseURL,
			apiKey,
			modelName,
			history,
			false, // Interactive user command = full autonomous execution!
			func(curSteps []model.AIOpsToolStep, hint string) {
				stepsBytes, _ := json.Marshal(curSteps)
				_ = DB.Model(&model.AIOpsChatMessage{}).Where("id = ?", msgID).Updates(map[string]any{
					"content":         fmt.Sprintf("⚡ [已完成 %d 步] %s", len(curSteps), hint),
					"tool_steps_json": string(stepsBytes),
				}).Error
			},
		)

		stepsBytes, _ := json.Marshal(steps)
		if errors.Is(runErr, context.Canceled) {
			_ = DB.Model(&model.AIOpsChatMessage{}).Where("id = ?", msgID).Updates(map[string]any{
				"content":         fmt.Sprintf("⏹ 任务已手动停止（停止前已完成 %d 步操作，可点击下方按钮接着继续）。", len(steps)),
				"status":          "cancelled",
				"tool_steps_json": string(stepsBytes),
			}).Error
			return
		}
		if runErr != nil {
			errMsg := "❌ 执行中断：" + runErr.Error()
			if len(steps) > 0 {
				errMsg = fmt.Sprintf("⚠️ 任务在第 %d 步后因超时或网络波动中断（`%s`）。\n\n前面已完成的 %d 步操作（如备份或拉取镜像）均已保留，无需重来，点击下方 **「🔄 接着刚才的进度继续完成」** 即可一键收尾！", len(steps), runErr.Error(), len(steps))
			}
			_ = DB.Model(&model.AIOpsChatMessage{}).Where("id = ?", msgID).Updates(map[string]any{
				"content":         errMsg,
				"status":          "error",
				"tool_steps_json": string(stepsBytes),
			}).Error
			return
		}
		_ = DB.Model(&model.AIOpsChatMessage{}).Where("id = ?", msgID).Updates(map[string]any{
			"content":         finalText,
			"status":          "done",
			"tool_steps_json": string(stepsBytes),
		}).Error
		_ = DB.Model(&model.AIOpsChatSession{}).Where("id = ?", sessID).Update("updated_at", time.Now()).Error
	}(session.ID, assistantMsg.ID)

	return session.ID, assistantMsg.ID, nil
}

func (ao *AIOpsClass) CancelSession(sessionID uint64) bool {
	ao.sessionMu.Lock()
	run, ok := ao.activeSessions[sessionID]
	ao.sessionMu.Unlock()
	if ok && run != nil && run.cancel != nil {
		run.cancel()
		return true
	}
	return false
}

func (ao *AIOpsClass) pruneOldSessions() {
	if DB == nil {
		return
	}
	var ids []uint64
	DB.Model(&model.AIOpsChatSession{}).Order("updated_at desc").Offset(50).Pluck("id", &ids)
	if len(ids) > 0 {
		DB.Where("session_id IN ?", ids).Delete(&model.AIOpsChatMessage{})
		DB.Where("id IN ?", ids).Delete(&model.AIOpsChatSession{})
	}
}

func (ao *AIOpsClass) pruneOldIncidents() {
	if DB == nil {
		return
	}
	var ids []uint64
	DB.Model(&model.AIOpsIncident{}).Order("id desc").Offset(200).Pluck("id", &ids)
	if len(ids) > 0 {
		DB.Where("id IN ?", ids).Delete(&model.AIOpsIncident{})
	}
}

// RunSentinelTick is invoked every 1 minute by Cron.
// Zero LLM tokens are consumed when all servers are within normal thresholds!
func (ao *AIOpsClass) RunSentinelTick() {
	cfg := ao.GetConfigSnapshot()
	now := time.Now()

	// Always record online servers so sudden-offline detection knows which servers were active
	if ServerShared != nil {
		ao.sentinelMu.Lock()
		for _, srv := range ServerShared.Range {
			if srv == nil {
				continue
			}
			snap := srv.RuntimeSnapshot()
			if srv.GetTaskStream() != nil && !snap.LastActive.IsZero() && now.Sub(snap.LastActive) < 90*time.Second {
				ao.everSeenOnline[srv.ID] = now
			}
		}
		ao.sentinelMu.Unlock()
	}

	if !cfg.Enabled || ServerShared == nil {
		return
	}

	// 1. Every 1 minute: evaluate real-time security metrics (outbound exfiltration & connection flood)
	if cfg.SecurityEnabled {
		secAnomalies := ao.evaluateRealtimeSecurityMetrics(cfg, now)
		if len(secAnomalies) > 0 {
			go func(items []detectedSecurityAnomaly) {
				for _, item := range items {
					ao.investigateSecurityAnomaly(item)
				}
			}(secAnomalies)
		}

		secInterval := cfg.SecurityIntervalMin
		if secInterval < 1 {
			secInterval = 2
		}
		ao.securityMu.Lock()
		dueSweep := ao.lastSecuritySweepAt.IsZero() || now.Sub(ao.lastSecuritySweepAt) >= time.Duration(secInterval)*time.Minute-15*time.Second
		if dueSweep {
			ao.lastSecuritySweepAt = now
		}
		ao.securityMu.Unlock()
		if dueSweep {
			go ao.runSecurityFingerprintSweep(cfg)
		}
	}

	ao.sentinelMu.Lock()
	if !ao.lastTickAt.IsZero() && now.Sub(ao.lastTickAt) < time.Duration(cfg.PatrolIntervalMin)*time.Minute-15*time.Second {
		ao.sentinelMu.Unlock()
		return
	}
	ao.lastTickAt = now

	type candidateAnomaly struct {
		server      *model.Server
		triggerType string
		summary     string
	}
	var candidates []candidateAnomaly

	for _, srv := range ServerShared.Range {
		if srv == nil {
			continue
		}
		b := buildServerBrief(srv, now)

		// 1. Check sudden offline (only if previously seen online in this Dashboard session)
		offlineKey := fmt.Sprintf("%d:offline", srv.ID)
		if !b.Online {
			if lastSeen, ok := ao.everSeenOnline[srv.ID]; ok && now.Sub(lastSeen) >= 2*time.Minute && now.Sub(lastSeen) <= 30*time.Minute {
				if now.After(ao.cooldownUntil[offlineKey]) {
					ao.cooldownUntil[offlineKey] = now.Add(time.Duration(cfg.CooldownMin) * time.Minute)
					candidates = append(candidates, candidateAnomaly{
						server:      srv,
						triggerType: "offline",
						summary:     fmt.Sprintf("服务器失联离线（上次在线 %s 前，地区 %s，IP %s）", now.Sub(lastSeen).Round(time.Second), b.Country, b.IPv4),
					})
				}
			}
			continue
		}

		// 2. Check CPU / Memory / Disk thresholds for online servers
		checks := []struct {
			kind      string
			exceeded  bool
			needCount int
			desc      string
		}{
			{
				kind:      "cpu",
				exceeded:  b.CPUPct >= cfg.CPUThreshold,
				needCount: 2,
				desc:      fmt.Sprintf("CPU 持续高达 %.1f%% (阈值 %.0f%%), Load1=%.2f, 进程数=%d", b.CPUPct, cfg.CPUThreshold, b.Load1, b.Procs),
			},
			{
				kind:      "memory",
				exceeded:  b.MemPct >= cfg.MemThreshold,
				needCount: 2,
				desc:      fmt.Sprintf("内存占用高达 %.1f%% (%d/%d MB, 阈值 %.0f%%)", b.MemPct, b.MemUsedMB, b.MemTotalMB, cfg.MemThreshold),
			},
			{
				kind:      "disk",
				exceeded:  b.DiskPct >= cfg.DiskThreshold,
				needCount: 1,
				desc:      fmt.Sprintf("硬盘空间占用 %.1f%% (%.1f/%.1f GB, 阈值 %.0f%%)", b.DiskPct, b.DiskUsedGB, b.DiskTotalGB, cfg.DiskThreshold),
			},
		}

		for _, chk := range checks {
			key := fmt.Sprintf("%d:%s", srv.ID, chk.kind)
			if chk.exceeded {
				ao.anomalyStreak[key]++
				if ao.anomalyStreak[key] >= chk.needCount && now.After(ao.cooldownUntil[key]) {
					ao.cooldownUntil[key] = now.Add(time.Duration(cfg.CooldownMin) * time.Minute)
					ao.anomalyStreak[key] = 0
					candidates = append(candidates, candidateAnomaly{
						server:      srv,
						triggerType: chk.kind,
						summary:     chk.desc,
					})
					break // One investigation covers the whole server
				}
			} else {
				ao.anomalyStreak[key] = 0
			}
		}
	}
	ao.sentinelMu.Unlock()

	if len(candidates) == 0 {
		return
	}

	if !ao.patrolRunning.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer ao.patrolRunning.Store(false)
		for _, cand := range candidates {
			ao.investigateServerAnomaly(cand.server, cand.triggerType, cand.summary)
		}
	}()
}

func (ao *AIOpsClass) investigateServerAnomaly(srv *model.Server, triggerType, triggerSummary string) {
	if DB == nil || srv == nil {
		return
	}
	cfg := ao.GetConfigSnapshot()
	smallURL := strings.TrimSpace(cfg.SmallBaseURL)
	smallKey := strings.TrimSpace(cfg.SmallAPIKey)
	smallModel := strings.TrimSpace(cfg.SmallModel)
	largeURL, largeKey, largeModel := cfg.EffectiveLargeEndpoint()

	incident := model.AIOpsIncident{
		ServerID:       srv.ID,
		ServerName:     srv.Name,
		TriggerType:    triggerType,
		TriggerSummary: triggerSummary,
		Status:         "triaging",
		Severity:       "medium",
	}
	_ = DB.Create(&incident).Error
	ao.pruneOldIncidents()

	// Offline server cannot run Agent commands; report directly with concise summary
	if triggerType == "offline" || srv.GetTaskStream() == nil {
		report := fmt.Sprintf("### 🔴 节点离线告警：%s (#%d)\n- **触发详情**：%s\n- **原因说明**：该机器 `nezha-agent` gRPC 通道已断开，无法远程下发排查指令。请检查母鸡电源状态、国际路由波动或服务商后台 VNC。", srv.Name, srv.ID, triggerSummary)
		_ = DB.Model(&incident).Updates(map[string]any{
			"status":        "reported",
			"severity":      "high",
			"small_verdict": "Agent 通道离线，直接推送失联提醒",
			"large_report":  report,
		}).Error
		ao.pushDiagnosisAlert(cfg, srv, fmt.Sprintf("🤖 AI 哨兵告警：[%s] 离线失联\n%s", srv.Name, triggerSummary))
		return
	}

	// Step 1: Capture fast diagnostic snapshot on target server via Agent
	snapCtx, snapCancel := context.WithTimeout(context.Background(), 20*time.Second)
	snapshotOut, _, snapErr := ao.DispatchAgentCommand(snapCtx, srv, aiOpsPatrolSnapshotSh)
	snapCancel()
	if snapErr != nil {
		snapshotOut = "抓取快照失败: " + snapErr.Error()
	} else {
		snapshotOut = truncateCommandOutput(snapshotOut)
	}

	// Step 2: Small Model Triage ("值班班长")
	if smallURL != "" && smallKey != "" && smallModel != "" {
		triagePrompt := fmt.Sprintf(`你是服务器集群的「一线值班班长（初筛模型）」。
本地监控哨兵发现服务器 [%s] (#%d) 出现指标异常：%s

以下是刚刚通过 Agent 抓取的机器实时快照：
%s

请判断这是【短暂正常波动/无需打扰管理员】，还是【需要转交高级模型深入排障的真实异常】（例如进程持续跑满、异常挖矿、容器崩溃重启 CrashLoop、内存耗尽、磁盘占满等）。
请严格只输出一段 JSON，格式如下：
{"escalate": true或false, "severity": "low或medium或high", "summary": "一句话中文判断理由"}`,
			srv.Name, srv.ID, triggerSummary, snapshotOut)

		tCtx, tCancel := context.WithTimeout(context.Background(), 45*time.Second)
		smallReply, sErr := callOpenAICompatible(tCtx, smallURL, smallKey, smallModel, []llmChatMessage{
			{Role: "user", Content: triagePrompt},
		}, nil, 512)
		tCancel()

		if sErr == nil {
			txt, _ := smallReply.Content.(string)
			verdict := parseSmallTriageVerdict(txt)
			if !verdict.Escalate {
				_ = DB.Model(&incident).Updates(map[string]any{
					"status":        "dismissed_by_small",
					"severity":      verdict.Severity,
					"small_verdict": fmt.Sprintf("[%s 初筛通过] %s", smallModel, verdict.Summary),
				}).Error
				return
			}
			_ = DB.Model(&incident).Updates(map[string]any{
				"status":        "diagnosing",
				"severity":      verdict.Severity,
				"small_verdict": fmt.Sprintf("[%s 判定需深查] %s", smallModel, verdict.Summary),
			}).Error
		}
	}

	// Step 3: Large Model Deep Investigation ("主治医生")
	if largeURL == "" || largeKey == "" || largeModel == "" {
		_ = DB.Model(&incident).Updates(map[string]any{
			"status":       "error",
			"large_report": "未配置高级模型参数，无法继续深度排查。",
		}).Error
		return
	}

	investigatePrompt := fmt.Sprintf(`低级哨兵模型向你汇报了以下服务器异常，请你接手深度排查：
- 目标服务器：%s (server_id = %d)
- 异常触发原因：%s
- 初步现场快照：
%s

请使用 exec_on_server 工具（server_id=%d）按需进一步检查可疑进程、Docker 容器日志或大文件目录，定位根本原因并给出中文诊断报告。`,
		srv.Name, srv.ID, triggerSummary, snapshotOut, srv.ID)

	invCtx, invCancel := context.WithTimeout(context.Background(), 3*time.Minute)
	report, steps, lErr := ao.runAgentReActLoop(
		invCtx,
		largeURL,
		largeKey,
		largeModel,
		[]llmChatMessage{{Role: "user", Content: investigatePrompt}},
		!cfg.AutoSelfHeal, // Read-only unless admin enabled AutoSelfHeal
		nil,
	)
	invCancel()

	stepsBytes, _ := json.Marshal(steps)
	if lErr != nil {
		_ = DB.Model(&incident).Updates(map[string]any{
			"status":          "error",
			"large_report":    "高级模型排查失败: " + lErr.Error(),
			"tool_steps_json": string(stepsBytes),
		}).Error
		return
	}

	finalStatus := "reported"
	if cfg.AutoSelfHeal {
		finalStatus = "healed"
	}
	_ = DB.Model(&incident).Updates(map[string]any{
		"status":          finalStatus,
		"large_report":    report,
		"tool_steps_json": string(stepsBytes),
	}).Error

	pushBody := fmt.Sprintf("🤖 AI 运维诊断报告 [%s]\n触发原因：%s\n\n%s", srv.Name, triggerSummary, report)
	if len([]rune(pushBody)) > 1200 {
		pushBody = string([]rune(pushBody)[:1200]) + "\n...(完整报告请登录面板 AI 运维助手查看)"
	}
	ao.pushDiagnosisAlert(cfg, srv, pushBody)
}

// TriggerManualPatrol runs an immediate fleet-wide patrol on demand (Small Model scan -> Large Model escalation if needed).
func (ao *AIOpsClass) TriggerManualPatrol() error {
	cfg := ao.GetConfigSnapshot()
	smallURL := strings.TrimSpace(cfg.SmallBaseURL)
	smallKey := strings.TrimSpace(cfg.SmallAPIKey)
	smallModel := strings.TrimSpace(cfg.SmallModel)
	if smallURL == "" || smallKey == "" || smallModel == "" {
		return errors.New("请先在「⚙️ 双模型与 Telegram 配置」中填好低级模型 API 参数并保存")
	}
	if !ao.patrolRunning.CompareAndSwap(false, true) {
		return errors.New("当前已有一次巡检正在运行中，请稍候查看结果")
	}

	go func() {
		defer ao.patrolRunning.Store(false)
		now := time.Now()
		var briefs []aiServerBrief
		var suspectServer *model.Server
		var suspectReason string

		if ServerShared != nil {
			for _, srv := range ServerShared.Range {
				if srv == nil {
					continue
				}
				b := buildServerBrief(srv, now)
				briefs = append(briefs, b)
				if b.Online && suspectServer == nil {
					if b.CPUPct >= cfg.CPUThreshold || b.MemPct >= cfg.MemThreshold || b.DiskPct >= cfg.DiskThreshold {
						suspectServer = srv
						suspectReason = fmt.Sprintf("手动全群巡检发现超阈值：CPU %.1f%%, 内存 %.1f%%, 硬盘 %.1f%%", b.CPUPct, b.MemPct, b.DiskPct)
					}
				}
			}
		}

		if suspectServer != nil {
			ao.investigateServerAnomaly(suspectServer, "manual_patrol", suspectReason)
			return
		}

		// All servers within thresholds: let Small Model generate a concise fleet health summary!
		incident := model.AIOpsIncident{
			ServerID:       0,
			ServerName:     fmt.Sprintf("全群服务器 (%d 台)", len(briefs)),
			TriggerType:    "manual_patrol",
			TriggerSummary: "管理员手动触发全群健康巡检",
			Status:         "triaging",
			Severity:       "low",
		}
		_ = DB.Create(&incident).Error
		ao.pruneOldIncidents()

		fleetJSON, _ := json.Marshal(briefs)
		prompt := fmt.Sprintf(`你是哪吒探针的「AI 巡检班长」。管理员刚刚手动触发了一次全群健康巡检，以下是全部 %d 台服务器的实时状态 JSON：
%s

请输出一份简明扼要的中文 Markdown 巡检简报：
1. 在线/离线机器概况；
2. 指出资源占用最高的前 2~3 台机器（CPU/内存/硬盘）以及是否健康；
3. 如果有离线机器或负载偏高的机器，提醒管理员关注。`, len(briefs), string(fleetJSON))

		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		reply, err := callOpenAICompatible(ctx, smallURL, smallKey, smallModel, []llmChatMessage{
			{Role: "user", Content: prompt},
		}, nil, 1500)
		cancel()

		if err != nil {
			_ = DB.Model(&incident).Updates(map[string]any{
				"status":       "error",
				"small_verdict": "巡检调用失败",
				"large_report": err.Error(),
			}).Error
			return
		}
		txt, _ := reply.Content.(string)
		_ = DB.Model(&incident).Updates(map[string]any{
			"status":        "reported",
			"severity":      "low",
			"small_verdict": fmt.Sprintf("[%s 全群巡检完成] 未发现超阈值告警节点，无需唤醒高级模型", smallModel),
			"large_report":  txt,
		}).Error
	}()

	return nil
}

func (ao *AIOpsClass) pushDiagnosisAlert(cfg model.AIOpsConfig, srv *model.Server, message string) {
	if cfg.NotificationGroupID > 0 && NotificationShared != nil {
		NotificationShared.SendNotification(cfg.NotificationGroupID, message, "", srv)
	}
	if cfg.TelegramEnabled && strings.TrimSpace(cfg.TelegramBotToken) != "" {
		ao.broadcastTelegramAdmins(cfg, message)
	}
}
