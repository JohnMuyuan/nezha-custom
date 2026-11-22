package singleton

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/nezhahq/nezha/model"
)

const (
	aiMaxToolOutputBytes = 16 * 1024
	aiHalfOutputBytes    = 7500
)

var (
	// Hard red-line patterns that are ALWAYS blocked even in autonomous ops mode.
	redLinePatterns = []*regexp.Regexp{
		// Protect nezha-agent itself so AI never cuts off its own gRPC control channel
		regexp.MustCompile(`(?i)\b(systemctl|service|rc-service)\s+(stop|restart|disable|mask|kill)\s+[^\n;|&]*nezha`),
		regexp.MustCompile(`(?i)\b(pkill|killall)\b[^\n;|&]*nezha`),
		regexp.MustCompile(`(?i)\b(rm|mv|chmod|unlink)\b[^\n;|&]*(/opt/nezha/agent|nezha-agent)`),
		// Protect root filesystem & block devices
		regexp.MustCompile(`(?i)\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(/|/\*)\s*($|[;|&])`),
		regexp.MustCompile(`(?i)--no-preserve-root`),
		regexp.MustCompile(`(?i)\b(mkfs|wipefs|fdisk|parted)\b`),
		regexp.MustCompile(`(?i)\bdd\b[^\n;|&]*\bof=/dev/(sd|vd|xvd|nvme|mmcblk|loop)`),
		// Fork bomb
		regexp.MustCompile(`:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;`),
		// Poweroff / network lockout
		regexp.MustCompile(`(?i)\b(shutdown|poweroff|halt)\b`),
		regexp.MustCompile(`(?i)\binit\s+0\b`),
		regexp.MustCompile(`(?i)\biptables\s+(-P\s+INPUT\s+DROP|-F\b)`),
		regexp.MustCompile(`(?i)\bip\s+link\s+set\s+\S+\s+down\b`),
	}

	// Mutating patterns rejected when readOnly == true (background unattended patrol without self-heal).
	readOnlyMutatingPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(^|[;&|]\s*)(sudo\s+)?(rm|rmdir|mv|cp|chmod|chown|kill|pkill|killall|reboot|truncate|fallocate|userdel|usermod|passwd|crontab)\b`),
		regexp.MustCompile(`(?i)\bdocker\s+(rm|rmi|stop|kill|restart|start|pull|run|exec| system\s+prune|container\s+prune|image\s+prune)\b`),
		regexp.MustCompile(`(?i)\bdocker(-|\s+)compose\s+(up|down|restart|stop|rm|pull)\b`),
		regexp.MustCompile(`(?i)\b(systemctl|service)\s+(start|stop|restart|reload|enable|disable)\b`),
		regexp.MustCompile(`(?i)\b(apt|apt-get|yum|dnf|apk|pacman|snap|pip|npm)\s+(install|remove|purge|upgrade|update|uninstall)\b`),
		regexp.MustCompile(`(?i)\bsed\s+-i\b`),
		regexp.MustCompile(`>>?\s*/(etc|var|opt|usr|root|home|boot)/`),
	}
)

// ValidateAICommandSafety enforces non-bypassable red-lines in Go before dispatching any command to an agent.
func ValidateAICommandSafety(cmd string, readOnly bool) error {
	trimmed := strings.TrimSpace(cmd)
	if trimmed == "" {
		return errors.New("命令不能为空")
	}
	for _, pat := range redLinePatterns {
		if pat.MatchString(trimmed) {
			return errors.New("安全护栏拦截：禁止停止/修改 nezha-agent 自身进程，或执行破坏磁盘/断网/关机等毁灭性指令")
		}
	}
	if readOnly {
		for _, pat := range readOnlyMutatingPatterns {
			if pat.MatchString(trimmed) {
				return errors.New("只读巡检模式拦截：后台自动巡检默认仅允许只读排查命令（如需修改可在对话窗口下达指令，或开启后台自愈开关）")
			}
		}
	}
	return nil
}

func truncateCommandOutput(out string) string {
	if len(out) <= aiMaxToolOutputBytes {
		return out
	}
	omitted := len(out) - 2*aiHalfOutputBytes
	return fmt.Sprintf("%s\n\n... [输出过长，中间已省略 %d 字节] ...\n\n%s",
		out[:aiHalfOutputBytes], omitted, out[len(out)-aiHalfOutputBytes:])
}

// wrapCommandForAgent runs Linux commands under bash (when available) with stdin closed (</dev/null)
// and stderr merged (2>&1), preventing dash 'Illegal option -o pipefail' errors and interactive hangs.
func wrapCommandForAgent(srv *model.Server, rawCmd string) string {
	if srv != nil {
		snap := srv.RuntimeSnapshot()
		if snap.Host != nil && strings.Contains(strings.ToLower(snap.Host.Platform), "windows") {
			return rawCmd
		}
	}
	b64 := base64.StdEncoding.EncodeToString([]byte(rawCmd))
	return fmt.Sprintf("__NZ_AI_CMD=$(printf '%%s' '%s' | base64 -d); if command -v bash >/dev/null 2>&1; then bash -c \"$__NZ_AI_CMD\" </dev/null 2>&1; else sh -c \"$__NZ_AI_CMD\" </dev/null 2>&1; fi", b64)
}

func round1(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Round(v*10) / 10
}

type aiServerBrief struct {
	ID          uint64  `json:"id"`
	Name        string  `json:"name"`
	Online      bool    `json:"online"`
	Country     string  `json:"country,omitempty"`
	IPv4        string  `json:"ipv4,omitempty"`
	Platform    string  `json:"platform,omitempty"`
	CPUPct      float64 `json:"cpu_pct"`
	MemPct      float64 `json:"mem_pct"`
	MemUsedMB   uint64  `json:"mem_used_mb"`
	MemTotalMB  uint64  `json:"mem_total_mb"`
	DiskPct     float64 `json:"disk_pct"`
	DiskUsedGB  float64 `json:"disk_used_gb"`
	DiskTotalGB float64 `json:"disk_total_gb"`
	Load1       float64 `json:"load1"`
	TCPConns    uint64  `json:"tcp_conns"`
	Procs       uint64  `json:"procs"`
	UptimeHours float64 `json:"uptime_hours"`
	Note        string  `json:"note,omitempty"`
}

func buildServerBrief(s *model.Server, now time.Time) aiServerBrief {
	snap := s.RuntimeSnapshot()
	online := s.GetTaskStream() != nil && !snap.LastActive.IsZero() && now.Sub(snap.LastActive) < 90*time.Second

	var country, ipv4, platform string
	if s.GeoIP != nil {
		country = strings.ToUpper(s.GeoIP.CountryCode)
		ipv4 = s.GeoIP.IP.IPv4Addr
	}
	var memTotal, diskTotal uint64
	if snap.Host != nil {
		platform = strings.TrimSpace(snap.Host.Platform + " " + snap.Host.PlatformVersion)
		memTotal = snap.Host.MemTotal
		diskTotal = snap.Host.DiskTotal
	}

	var cpuPct, memPct, diskPct, load1, uptimeH float64
	var memUsed, diskUsed, tcpConns, procs uint64
	if snap.State != nil {
		cpuPct = round1(snap.State.CPU)
		memUsed = snap.State.MemUsed
		diskUsed = snap.State.DiskUsed
		if memTotal > 0 {
			memPct = round1(float64(memUsed) / float64(memTotal) * 100)
		}
		if diskTotal > 0 {
			diskPct = round1(float64(diskUsed) / float64(diskTotal) * 100)
		}
		load1 = round1(snap.State.Load1)
		tcpConns = snap.State.TcpConnCount
		procs = snap.State.ProcessCount
		uptimeH = round1(float64(snap.State.Uptime) / 3600.0)
	}

	return aiServerBrief{
		ID:          s.ID,
		Name:        s.Name,
		Online:      online,
		Country:     country,
		IPv4:        ipv4,
		Platform:    platform,
		CPUPct:      cpuPct,
		MemPct:      memPct,
		MemUsedMB:   memUsed / (1024 * 1024),
		MemTotalMB:  memTotal / (1024 * 1024),
		DiskPct:     diskPct,
		DiskUsedGB:  round1(float64(diskUsed) / (1024 * 1024 * 1024)),
		DiskTotalGB: round1(float64(diskTotal) / (1024 * 1024 * 1024)),
		Load1:       load1,
		TCPConns:    tcpConns,
		Procs:       procs,
		UptimeHours: uptimeH,
		Note:        strings.TrimSpace(s.Note),
	}
}

func buildAIOpsToolDefinitions(readOnly bool) []llmToolDef {
	execDesc := "在指定服务器上通过哪吒 Agent 通道直接执行非交互式 Linux/Windows 命令（无需 SSH 密钥），返回退出状态与输出。升级容器前请务必先用 docker inspect / docker ps 探明该容器的 Compose 目录或启动参数，切勿盲目删除容器；修改完成后请再次检查服务运行状态与日志。"
	if readOnly {
		execDesc = "在指定服务器上通过哪吒 Agent 通道执行只读诊断命令（如 ps, top -bn1, free -m, df -h, du, ss -tunlp, docker ps -a, docker logs --tail 80, journalctl -n 60, dmesg | tail），用于深度定位故障根因。"
	}

	return []llmToolDef{
		{
			Type: "function",
			Function: llmFunctionDef{
				Name:        "list_servers",
				Description: "获取哪吒探针纳管的服务器列表与实时资源指标（ID、名称、在线状态、国家地区、IP、CPU%、内存%、硬盘%、负载、连接数、进程数）。支持按关键词模糊筛选。",
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"query": map[string]any{
							"type":        "string",
							"description": "可选筛选关键词（匹配机器名称、国家代码如 HK/US/JP、IP 或备注）；留空返回全部服务器。",
						},
					},
				},
			},
		},
		{
			Type: "function",
			Function: llmFunctionDef{
				Name:        "get_server_detail",
				Description: "获取单台服务器的详细硬件规格、Swap、网卡累计流量、温度传感器以及流媒体/IP质量体检摘要。",
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"server_id": map[string]any{
							"type":        "integer",
							"description": "目标服务器数字 ID",
						},
					},
					"required": []string{"server_id"},
				},
			},
		},
		{
			Type: "function",
			Function: llmFunctionDef{
				Name:        "exec_on_server",
				Description: execDesc,
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"server_id": map[string]any{
							"type":        "integer",
							"description": "目标服务器数字 ID",
						},
						"command": map[string]any{
							"type":        "string",
							"description": "要执行的 Shell 命令（Linux 节点自动使用 bash 执行并合并 stderr，支持 pipefail/数组；严禁无退出条件的交互式命令）",
						},
						"timeout_seconds": map[string]any{
							"type":        "integer",
							"description": "单条命令超时秒数（默认 120，大型备份或拉取多个 Docker 镜像可设为 240~360）",
						},
					},
					"required": []string{"server_id", "command"},
				},
			},
		},
	}
}

func (ao *AIOpsClass) executeToolCall(
	ctx context.Context,
	call llmToolCall,
	readOnly bool,
) (toolOutput string, step model.AIOpsToolStep) {
	start := time.Now()
	name := call.Function.Name
	step.Tool = name

	defer func() {
		step.DurationMs = time.Since(start).Milliseconds()
	}()

	switch name {
	case "list_servers":
		var args struct {
			Query string `json:"query"`
		}
		_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
		q := strings.ToLower(strings.TrimSpace(args.Query))
		now := time.Now()

		var list []aiServerBrief
		if ServerShared != nil {
			for _, srv := range ServerShared.Range {
				if srv == nil {
					continue
				}
				b := buildServerBrief(srv, now)
				if q != "" {
					hay := strings.ToLower(fmt.Sprintf("%d %s %s %s %s %s %s",
						b.ID, b.Name, b.Country, b.IPv4, b.Platform, srv.Note, srv.PublicNote))
					if !strings.Contains(hay, q) {
						continue
					}
				}
				list = append(list, b)
			}
		}
		slices.SortFunc(list, func(a, b aiServerBrief) int {
			if a.ID < b.ID {
				return -1
			}
			if a.ID > b.ID {
				return 1
			}
			return 0
		})
		step.Summary = fmt.Sprintf("查询服务器列表（匹配 %d 台）", len(list))
		raw, _ := json.Marshal(list)
		step.Output = fmt.Sprintf("共返回 %d 台服务器状态", len(list))
		return string(raw), step

	case "get_server_detail":
		var args struct {
			ServerID uint64 `json:"server_id"`
		}
		if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil || args.ServerID == 0 {
			step.IsError = true
			step.Summary = "参数错误：缺少有效的 server_id"
			return `{"error":"invalid server_id"}`, step
		}
		step.ServerID = args.ServerID
		if ServerShared == nil {
			step.IsError = true
			return `{"error":"server registry unavailable"}`, step
		}
		srv, ok := ServerShared.Get(args.ServerID)
		if !ok || srv == nil {
			step.IsError = true
			step.Summary = fmt.Sprintf("未找到服务器 #%d", args.ServerID)
			return fmt.Sprintf(`{"error":"server %d not found"}`, args.ServerID), step
		}
		step.ServerName = srv.Name
		step.Summary = fmt.Sprintf("读取 [%s] 详细硬件与体检信息", srv.Name)

		snap := srv.RuntimeSnapshot()
		detail := map[string]any{
			"brief":       buildServerBrief(srv, time.Now()),
			"host":        snap.Host,
			"state":       snap.State,
			"last_active": snap.LastActive,
			"public_note": srv.PublicNote,
		}
		if InspectionShared != nil {
			ins := InspectionShared.Get(srv.ID)
			if ins != nil && !ins.UpdatedAt.IsZero() {
				detail["inspection"] = ins
			}
		}
		raw, _ := json.Marshal(detail)
		out := truncateCommandOutput(string(raw))
		step.Output = fmt.Sprintf("已获取 [%s] 硬件与运行详情", srv.Name)
		return out, step

	case "exec_on_server":
		var args struct {
			ServerID       uint64 `json:"server_id"`
			Command        string `json:"command"`
			TimeoutSeconds int    `json:"timeout_seconds"`
		}
		if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil {
			// Also handle string server_id from loose models
			var loose map[string]any
			if json.Unmarshal([]byte(call.Function.Arguments), &loose) == nil {
				if sidStr, ok := loose["server_id"].(string); ok {
					args.ServerID, _ = strconv.ParseUint(sidStr, 10, 64)
				}
				if cmdStr, ok := loose["command"].(string); ok {
					args.Command = cmdStr
				}
			}
		}
		step.ServerID = args.ServerID
		step.Command = args.Command

		if args.ServerID == 0 || strings.TrimSpace(args.Command) == "" {
			step.IsError = true
			step.Summary = "参数缺失：server_id 或 command 为空"
			return `{"error":"server_id and command are required"}`, step
		}
		if ServerShared == nil {
			step.IsError = true
			return `{"error":"server registry unavailable"}`, step
		}
		srv, ok := ServerShared.Get(args.ServerID)
		if !ok || srv == nil {
			step.IsError = true
			step.Summary = fmt.Sprintf("服务器 #%d 不存在", args.ServerID)
			return fmt.Sprintf(`{"error":"server %d not found"}`, args.ServerID), step
		}
		step.ServerName = srv.Name

		if err := ValidateAICommandSafety(args.Command, readOnly); err != nil {
			step.IsError = true
			step.Summary = fmt.Sprintf("安全拦截 [%s]: %s", srv.Name, err.Error())
			step.Output = err.Error()
			return fmt.Sprintf(`{"error":%q}`, err.Error()), step
		}

		timeout := 120 * time.Second
		if args.TimeoutSeconds >= 10 && args.TimeoutSeconds <= 360 {
			timeout = time.Duration(args.TimeoutSeconds) * time.Second
		}
		// Detach per-command context from short parent blips while still honoring explicit session cancellation
		cmdCtx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()

		wrappedCmd := wrapCommandForAgent(srv, args.Command)
		out, okExec, err := ao.DispatchAgentCommand(cmdCtx, srv, wrappedCmd)
		truncated := truncateCommandOutput(out)
		step.Output = truncated
		if err != nil {
			step.IsError = true
			step.Summary = fmt.Sprintf("在 [%s] 执行失败: %v", srv.Name, err)
			resp, _ := json.Marshal(map[string]any{
				"success": false,
				"error":   err.Error(),
				"output":  truncated,
			})
			return string(resp), step
		}
		step.IsError = !okExec
		step.Summary = fmt.Sprintf("在 [%s] 执行命令完成", srv.Name)
		resp, _ := json.Marshal(map[string]any{
			"success": okExec,
			"output":  truncated,
		})
		return string(resp), step

	default:
		step.IsError = true
		step.Summary = "未知工具: " + name
		return fmt.Sprintf(`{"error":"unknown tool %s"}`, name), step
	}
}
