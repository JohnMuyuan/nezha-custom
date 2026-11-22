package singleton

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nezhahq/nezha/model"
)

const (
	aiOpsSecurityProbeSh = `export LC_ALL=C
echo "===WHO==="
who 2>/dev/null | head -n 20
echo "===AUTH_ACCEPTED==="
if command -v journalctl >/dev/null 2>&1; then
  journalctl -u ssh -u sshd --since "-12min" --no-pager -q 2>/dev/null | grep -E "Accepted (password|publickey|keyboard-interactive)" | tail -n 12
fi
for f in /var/log/auth.log /var/log/secure; do
  if [ -r "$f" ]; then
    tail -n 250 "$f" 2>/dev/null | grep -E "Accepted (password|publickey|keyboard-interactive)" | tail -n 12
    break
  fi
done
echo "===HASHES==="
for p in /root/.ssh/authorized_keys /etc/passwd /etc/shadow /etc/sudoers /etc/ld.so.preload /etc/crontab; do
  if [ -e "$p" ]; then
    sha256sum "$p" 2>/dev/null
  else
    echo "MISSING $p"
  fi
done
find /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly /var/spool/cron/crontabs /var/spool/cron -maxdepth 1 -type f ! -name '*.swp' ! -name '*.tmp*' ! -name '.#*' ! -name '*~' 2>/dev/null | LC_ALL=C sort -u | head -n 80 | while IFS= read -r cf; do
  sha256sum "$cf" 2>/dev/null
done
echo "===HASHES_END==="
echo "===BRUTE_10M==="
if command -v journalctl >/dev/null 2>&1; then
  journalctl -u ssh -u sshd --since "-10min" --no-pager -q 2>/dev/null | grep -c "Failed password" || true
fi`

	aiOpsSSHForensicSh = `export LC_ALL=C; echo "=== ACTIVE TTY & COMMANDS (w) ==="; w 2>/dev/null; echo "=== PROCESS TREE ==="; ps -eo pid,ppid,user,%cpu,%mem,lstart,args --sort=-pid 2>/dev/null | head -n 35; echo "=== LAST 10 LOGINS ==="; last -n 10 -i 2>/dev/null; echo "=== ESTABLISHED SSH/NET ==="; ss -tunp state established 2>/dev/null | head -n 30; echo "=== AUTHORIZED_KEYS META ==="; ls -la /root/.ssh 2>/dev/null; tail -n 10 /root/.ssh/authorized_keys 2>/dev/null`

	aiOpsTamperForensicSh = `export LC_ALL=C; echo "=== ACTIVE TTY & COMMANDS (w) ==="; w 2>/dev/null; echo "=== LAST 8 LOGINS ==="; last -n 8 -i 2>/dev/null; echo "=== SENSITIVE & CRON META ==="; ls -la --full-time /etc/crontab /etc/cron.d /var/spool/cron/crontabs /root/.ssh/authorized_keys /etc/passwd /etc/sudoers /etc/ld.so.preload 2>/dev/null; echo "=== ROOT CRONTAB ==="; crontab -l 2>/dev/null | tail -n 30; echo "=== RECENT PROCESSES ==="; ps -eo pid,ppid,user,%cpu,%mem,lstart,args --sort=-pid 2>/dev/null | head -n 25`

	aiOpsExfilForensicSh = `export LC_ALL=C; echo "=== ESTABLISHED OUTBOUND CONNECTIONS ==="; ss -tunp state established 2>/dev/null | head -n 45; echo "=== TOP REMOTE IPS ==="; ss -ntu state established 2>/dev/null | awk 'NR>1 {print $5}' | sed 's/:[0-9]*$//' | sort | uniq -c | sort -nr | head -n 15; echo "=== TOP PROCESSES ==="; ps -eo pid,user,%cpu,%mem,comm,args --sort=-%cpu 2>/dev/null | head -n 20; echo "=== ACTIVE USERS ==="; w 2>/dev/null`

	aiOpsAttackForensicSh = `export LC_ALL=C; echo "=== SOCKET SUMMARY ==="; ss -s 2>/dev/null; echo "=== TOP 20 CONNECTION SOURCE IPS ==="; ss -ntu 2>/dev/null | awk 'NR>1 {print $5}' | sed 's/:[0-9]*$//' | sort | uniq -c | sort -nr | head -n 20; echo "=== LISTEN PORTS ==="; ss -tunlp 2>/dev/null | head -n 25; echo "=== RECENT WEB ACCESS LOGS ==="; for lf in /var/log/nginx/access.log /opt/1panel/apps/openresty/openresty/log/access.log /www/sites/*/log/access.log /var/log/caddy/*.log; do if [ -r "$lf" ]; then echo "--- $lf ---"; tail -n 25 "$lf" 2>/dev/null; fi; done`
)

var (
	whoIPRegex      = regexp.MustCompile(`\(([^()]+)\)\s*$`)
	acceptedIPRegex = regexp.MustCompile(`Accepted\s+(\S+)\s+for\s+(\S+)\s+from\s+([0-9a-fA-F:.]+)`)
)

type sshLoginEvent struct {
	User   string
	IP     string
	Method string
	Raw    string
}

type securityProbeResult struct {
	ActiveSSH      []sshLoginEvent
	AcceptedSSH    []sshLoginEvent
	FileHashes     map[string]string
	HashesComplete bool
	BruteCount10m  int
}

type serverSecurityState struct {
	initialized     bool
	fileHashes      map[string]string
	seenLogins      map[string]time.Time
	emaOutBps       float64
	emaConns        float64
	metricSamples   int
	outSpikeStreak  int
	connSpikeStreak int
}

func isTrustedSSHIP(ipStr string, allowlistRaw string) bool {
	cleaned := strings.TrimSpace(strings.Trim(ipStr, "[]"))
	if cleaned == "" || cleaned == "127.0.0.1" || cleaned == "::1" || strings.EqualFold(cleaned, "localhost") {
		return true
	}
	parsedAddr, addrErr := netip.ParseAddr(cleaned)
	if addrErr == nil && parsedAddr.IsLoopback() {
		return true
	}

	for _, entry := range strings.FieldsFunc(allowlistRaw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t' || r == ' ' || r == '，'
	}) {
		token := strings.TrimSpace(entry)
		if token == "" {
			continue
		}
		if strings.EqualFold(cleaned, token) {
			return true
		}
		if strings.HasSuffix(token, "*") {
			prefix := strings.TrimSuffix(token, "*")
			if prefix != "" && strings.HasPrefix(cleaned, prefix) {
				return true
			}
		}
		if cidr, err := netip.ParsePrefix(token); err == nil && addrErr == nil {
			if cidr.Contains(parsedAddr) {
				return true
			}
		}
	}
	return false
}

func parseSecurityProbeOutput(raw string) securityProbeResult {
	res := securityProbeResult{
		FileHashes: make(map[string]string),
	}
	section := ""
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		switch trimmed {
		case "===WHO===":
			section = "who"
			continue
		case "===AUTH_ACCEPTED===":
			section = "accepted"
			continue
		case "===HASHES===":
			section = "hashes"
			continue
		case "===HASHES_END===":
			res.HashesComplete = true
			section = ""
			continue
		case "===BRUTE_10M===":
			section = "brute"
			continue
		}

		switch section {
		case "who":
			m := whoIPRegex.FindStringSubmatch(trimmed)
			if len(m) >= 2 {
				candidateIP := strings.TrimSpace(strings.Trim(m[1], "[]"))
				// Only treat real IP addresses as remote network logins (ignores tmux/screen/:0 local displays)
				if addr, err := netip.ParseAddr(candidateIP); err == nil && !addr.IsLoopback() {
					fields := strings.Fields(trimmed)
					user := "unknown"
					if len(fields) > 0 {
						user = fields[0]
					}
					res.ActiveSSH = append(res.ActiveSSH, sshLoginEvent{
						User:   user,
						IP:     candidateIP,
						Method: "active-pty",
						Raw:    trimmed,
					})
				}
			}

		case "accepted":
			m := acceptedIPRegex.FindStringSubmatch(trimmed)
			if len(m) >= 4 {
				ip := strings.TrimSpace(m[3])
				if addr, err := netip.ParseAddr(ip); err == nil && !addr.IsLoopback() {
					res.AcceptedSSH = append(res.AcceptedSSH, sshLoginEvent{
						Method: m[1],
						User:   m[2],
						IP:     ip,
						Raw:    trimmed,
					})
				}
			}

		case "hashes":
			if strings.HasPrefix(trimmed, "MISSING ") {
				path := strings.TrimSpace(strings.TrimPrefix(trimmed, "MISSING "))
				if path != "" {
					res.FileHashes[path] = "MISSING"
				}
			} else {
				fields := strings.Fields(trimmed)
				if len(fields) >= 2 && len(fields[0]) == 64 {
					res.FileHashes[fields[1]] = fields[0]
				}
			}

		case "brute":
			if n, err := strconv.Atoi(trimmed); err == nil && n > res.BruteCount10m {
				res.BruteCount10m = n
			}
		}
	}
	return res
}

type detectedSecurityAnomaly struct {
	server        *model.Server
	triggerType   string // security_ssh | security_tamper | security_exfil | security_attack | security_bruteforce
	summary       string
	forensicSh    string
	directToLarge bool
}

// evaluateRealtimeSecurityMetrics checks every online server's outbound transfer speed & connection counts
// in pure Go memory (0 Agent commands, 0 Tokens unless a sustained anomaly occurs).
func (ao *AIOpsClass) evaluateRealtimeSecurityMetrics(cfg model.AIOpsConfig, now time.Time) []detectedSecurityAnomaly {
	if !cfg.SecurityEnabled || ServerShared == nil {
		return nil
	}
	outThresholdBps := cfg.OutboundSpikeMbps * 125_000 // 1 Mbps = 125,000 Bytes/s
	if outThresholdBps <= 0 {
		outThresholdBps = 50 * 125_000
	}
	connThreshold := cfg.ConnSpikeThreshold
	if connThreshold == 0 {
		connThreshold = 1200
	}

	var anomalies []detectedSecurityAnomaly

	ao.securityMu.Lock()
	defer ao.securityMu.Unlock()

	for _, srv := range ServerShared.Range {
		if srv == nil {
			continue
		}
		snap := srv.RuntimeSnapshot()
		if srv.GetTaskStream() == nil || snap.State == nil || snap.LastActive.IsZero() || now.Sub(snap.LastActive) >= 90*time.Second {
			continue
		}

		st := ao.ensureSecurityStateLocked(srv.ID)
		outBps := float64(snap.State.NetOutSpeed)
		totalConns := snap.State.TcpConnCount + snap.State.UdpConnCount
		connsF := float64(totalConns)

		// 1. Outbound Data Exfiltration / Abnormal Outbound Flood Check
		outSpike := outBps >= outThresholdBps && (st.metricSamples < 3 || outBps >= max(outThresholdBps, st.emaOutBps*3.5))
		if outSpike {
			st.outSpikeStreak++
			exfilKey := fmt.Sprintf("%d:security_exfil", srv.ID)
			if st.outSpikeStreak >= 3 && now.After(ao.securityCooldown[exfilKey]) {
				ao.securityCooldown[exfilKey] = now.Add(time.Duration(cfg.CooldownMin) * time.Minute)
				st.outSpikeStreak = 0
				mbps := outBps / 125_000.0
				baseMbps := st.emaOutBps / 125_000.0
				anomalies = append(anomalies, detectedSecurityAnomaly{
					server:        srv,
					triggerType:   "security_exfil",
					summary:       fmt.Sprintf("疑似数据外泄 / 异常对外发包：上传网速持续达 %.1f Mbps（平时基线 %.1f Mbps）", mbps, baseMbps),
					forensicSh:    aiOpsExfilForensicSh,
					directToLarge: false, // Small model checks if it's normal proxy/CDN process vs suspicious exfiltration
				})
			}
		} else {
			st.outSpikeStreak = 0
			if st.metricSamples == 0 {
				st.emaOutBps = outBps
			} else {
				st.emaOutBps = st.emaOutBps*0.92 + outBps*0.08
			}
		}

		// 2. Website Under Attack / CC / TCP+UDP Connection Surge Check
		connSpike := totalConns >= connThreshold && (st.metricSamples < 3 || connsF >= st.emaConns*3.5+400)
		if connSpike {
			st.connSpikeStreak++
			atkKey := fmt.Sprintf("%d:security_attack", srv.ID)
			if st.connSpikeStreak >= 2 && now.After(ao.securityCooldown[atkKey]) {
				ao.securityCooldown[atkKey] = now.Add(time.Duration(cfg.CooldownMin) * time.Minute)
				st.connSpikeStreak = 0
				anomalies = append(anomalies, detectedSecurityAnomaly{
					server:        srv,
					triggerType:   "security_attack",
					summary:       fmt.Sprintf("疑似网站被攻击 / 连接数洪泛：实时并发连接飙升至 %d (TCP %d / UDP %d，平时基线 %.0f)", totalConns, snap.State.TcpConnCount, snap.State.UdpConnCount, st.emaConns),
					forensicSh:    aiOpsAttackForensicSh,
					directToLarge: false,
				})
			}
		} else {
			st.connSpikeStreak = 0
			if st.metricSamples == 0 {
				st.emaConns = connsF
			} else {
				st.emaConns = st.emaConns*0.92 + connsF*0.08
			}
		}

		st.metricSamples++
	}

	return anomalies
}

func (ao *AIOpsClass) ensureSecurityStateLocked(serverID uint64) *serverSecurityState {
	st, ok := ao.securityStates[serverID]
	if !ok {
		st = &serverSecurityState{
			fileHashes: make(map[string]string),
			seenLogins: make(map[string]time.Time),
		}
		ao.securityStates[serverID] = st
	}
	return st
}

// runSecurityFingerprintSweep runs every SecurityIntervalMin (default 5m) in a staggered background worker
// to detect unauthorized SSH logins and tampering of authorized_keys / passwd / sudoers / crontabs.
func (ao *AIOpsClass) runSecurityFingerprintSweep(cfg model.AIOpsConfig) {
	if !cfg.SecurityEnabled || ServerShared == nil {
		return
	}
	if !ao.securitySweepRunning.CompareAndSwap(false, true) {
		return
	}
	defer ao.securitySweepRunning.Store(false)

	var linuxServers []*model.Server
	now := time.Now()
	for _, srv := range ServerShared.Range {
		if srv == nil || srv.GetTaskStream() == nil {
			continue
		}
		snap := srv.RuntimeSnapshot()
		if snap.LastActive.IsZero() || now.Sub(snap.LastActive) >= 90*time.Second {
			continue
		}
		if snap.Host != nil && strings.Contains(strings.ToLower(snap.Host.Platform), "windows") {
			continue
		}
		linuxServers = append(linuxServers, srv)
	}

	var urgentFindings []detectedSecurityAnomaly

	// Staggered probe across online Linux servers (max 3 concurrent lightweight probes)
	sem := make(chan struct{}, 3)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, srv := range linuxServers {
		srv := srv
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()

			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			out, _, err := ao.DispatchAgentCommand(ctx, srv, aiOpsSecurityProbeSh)
			cancel()
			if err != nil || strings.TrimSpace(out) == "" {
				return
			}

			parsed := parseSecurityProbeOutput(out)
			found := ao.diffServerSecurityFingerprint(srv, parsed, cfg, time.Now())
			if len(found) > 0 {
				mu.Lock()
				urgentFindings = append(urgentFindings, found...)
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	for _, item := range urgentFindings {
		ao.investigateSecurityAnomaly(item)
	}
}

func (ao *AIOpsClass) diffServerSecurityFingerprint(
	srv *model.Server,
	parsed securityProbeResult,
	cfg model.AIOpsConfig,
	now time.Time,
) []detectedSecurityAnomaly {
	ao.securityMu.Lock()
	defer ao.securityMu.Unlock()

	st := ao.ensureSecurityStateLocked(srv.ID)

	// Prune expired login dedup entries (> 4 hours)
	for k, ts := range st.seenLogins {
		if now.Sub(ts) > 4*time.Hour {
			delete(st.seenLogins, k)
		}
	}

	// First scan after Dashboard boot: record baseline silently without false-alarming on historical logins!
	if !st.initialized {
		for _, ev := range parsed.AcceptedSSH {
			st.seenLogins["acc:"+ev.Raw] = now
		}
		for _, ev := range parsed.ActiveSSH {
			st.seenLogins["who:"+ev.User+"@"+ev.IP] = now
		}
		if parsed.HashesComplete {
			for k, v := range parsed.FileHashes {
				st.fileHashes[k] = v
			}
			st.initialized = true
		}
		return nil
	}

	var findings []detectedSecurityAnomaly

	// 1. Check for NEW untrusted SSH logins (Accepted or newly appeared interactive PTY)
	var untrustedEvents []string
	for _, ev := range parsed.AcceptedSSH {
		key := "acc:" + ev.Raw
		if _, seen := st.seenLogins[key]; seen {
			continue
		}
		st.seenLogins[key] = now
		if !isTrustedSSHIP(ev.IP, cfg.TrustedSSHIPS) {
			untrustedEvents = append(untrustedEvents, fmt.Sprintf("用户 %s 通过 %s 从陌生 IP [%s] 成功登录 SSH", ev.User, ev.Method, ev.IP))
		}
	}
	for _, ev := range parsed.ActiveSSH {
		key := "who:" + ev.User + "@" + ev.IP
		if _, seen := st.seenLogins[key]; seen {
			continue
		}
		st.seenLogins[key] = now
		if !isTrustedSSHIP(ev.IP, cfg.TrustedSSHIPS) {
			untrustedEvents = append(untrustedEvents, fmt.Sprintf("检测到来自陌生 IP [%s] 的活跃 SSH 终端会话 (用户: %s)", ev.IP, ev.User))
		}
	}

	if len(untrustedEvents) > 0 {
		sshCooldownKey := fmt.Sprintf("%d:security_ssh", srv.ID)
		if now.After(ao.securityCooldown[sshCooldownKey]) {
			ao.securityCooldown[sshCooldownKey] = now.Add(5 * time.Minute)
			findings = append(findings, detectedSecurityAnomaly{
				server:        srv,
				triggerType:   "security_ssh",
				summary:       "🚨 陌生 IP 登录 SSH 预警：" + strings.Join(untrustedEvents, "；"),
				forensicSh:    aiOpsSSHForensicSh,
				directToLarge: true, // High-risk security event: escalate straight to Large Model!
			})
		}
	}

	// 2. Check for content-level tampering of critical backdoor-sensitive files & cron job files
	// (Only compare when ===HASHES_END=== completed cleanly; never hashes directory '.'/'..' mtimes!)
	if parsed.HashesComplete {
		isCronFile := func(p string) bool {
			return strings.HasPrefix(p, "/etc/cron.") || strings.HasPrefix(p, "/var/spool/cron/")
		}
		var tamperedPaths []string
		for path, newHash := range parsed.FileHashes {
			oldHash, existed := st.fileHashes[path]
			if !existed {
				tamperedPaths = append(tamperedPaths, "新增 "+path)
			} else if oldHash != newHash {
				tamperedPaths = append(tamperedPaths, path)
			}
		}
		for oldPath := range st.fileHashes {
			if isCronFile(oldPath) {
				if _, stillExists := parsed.FileHashes[oldPath]; !stillExists {
					tamperedPaths = append(tamperedPaths, "删除 "+oldPath)
				}
			}
		}
		st.fileHashes = make(map[string]string, len(parsed.FileHashes))
		for k, v := range parsed.FileHashes {
			st.fileHashes[k] = v
		}
		slices.Sort(tamperedPaths)

		if len(tamperedPaths) > 0 {
			tamperKey := fmt.Sprintf("%d:security_tamper", srv.ID)
			if now.After(ao.securityCooldown[tamperKey]) {
				ao.securityCooldown[tamperKey] = now.Add(15 * time.Minute)
				findings = append(findings, detectedSecurityAnomaly{
					server:        srv,
					triggerType:   "security_tamper",
					summary:       fmt.Sprintf("🚨 敏感系统文件被篡改变动：%s", strings.Join(tamperedPaths, ", ")),
					forensicSh:    aiOpsTamperForensicSh,
					directToLarge: true, // High-risk tamper event: escalate straight to Large Model!
				})
			}
		}
	}

	// 3. Check for intense ongoing SSH brute-force attack (>= 600 failed attempts in 10 minutes)
	if parsed.BruteCount10m >= 600 {
		bruteKey := fmt.Sprintf("%d:security_bruteforce", srv.ID)
		if now.After(ao.securityCooldown[bruteKey]) {
			ao.securityCooldown[bruteKey] = now.Add(6 * time.Hour)
			findings = append(findings, detectedSecurityAnomaly{
				server:        srv,
				triggerType:   "security_bruteforce",
				summary:       fmt.Sprintf("🟠 SSH 正遭猛烈暴力破解：过去 10 分钟内失败尝试高达 %d 次", parsed.BruteCount10m),
				forensicSh:    `export LC_ALL=C; lastb -n 40 -i 2>/dev/null | head -n 30; systemctl is-active fail2ban 2>/dev/null || true`,
				directToLarge: false,
			})
		}
	}

	return findings
}

func (ao *AIOpsClass) investigateSecurityAnomaly(item detectedSecurityAnomaly) {
	if DB == nil || item.server == nil {
		return
	}
	srv := item.server
	cfg := ao.GetConfigSnapshot()
	smallURL := strings.TrimSpace(cfg.SmallBaseURL)
	smallKey := strings.TrimSpace(cfg.SmallAPIKey)
	smallModel := strings.TrimSpace(cfg.SmallModel)
	largeURL, largeKey, largeModel := cfg.EffectiveLargeEndpoint()

	sev := "high"
	if !item.directToLarge {
		sev = "medium"
	}

	incident := model.AIOpsIncident{
		ServerID:       srv.ID,
		ServerName:     srv.Name,
		TriggerType:    item.triggerType,
		TriggerSummary: item.summary,
		Status:         "diagnosing",
		Severity:       sev,
	}
	_ = DB.Create(&incident).Error
	ao.pruneOldIncidents()

	// Step 1: Capture specialized security forensic snapshot
	snapCtx, snapCancel := context.WithTimeout(context.Background(), 25*time.Second)
	forensicOut, _, snapErr := ao.DispatchAgentCommand(snapCtx, srv, item.forensicSh)
	snapCancel()
	if snapErr != nil {
		forensicOut = "抓取安全取证快照失败: " + snapErr.Error()
	} else {
		forensicOut = truncateCommandOutput(forensicOut)
	}

	// Step 2: For traffic/connection surges (not confirmed SSH login/file tamper), let Small Model filter normal proxy/CDN bursts first
	if !item.directToLarge && smallURL != "" && smallKey != "" && smallModel != "" {
		triagePrompt := fmt.Sprintf(`你是服务器集群的「AI 安全值班员」。
安全哨兵在服务器 [%s] (#%d) 捕获到以下网络/安全异常：%s

以下是刚刚通过 Agent 抓取的现场取证快照：
%s

请判断这是【正常的代理/反代/业务流量高峰（无需惊动管理员）】，还是【疑似真实的数据外泄、恶意被控发包、网站遭遇 CC/DDoS 攻击或高危爆破，需要高级专家深入取证】。
请严格只输出一段 JSON：
{"escalate": true或false, "severity": "low或medium或high", "summary": "一句话中文判断结论"}`,
			srv.Name, srv.ID, item.summary, forensicOut)

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
					"small_verdict": fmt.Sprintf("[%s 安全初筛放行] %s", smallModel, verdict.Summary),
				}).Error
				return
			}
			_ = DB.Model(&incident).Updates(map[string]any{
				"severity":      verdict.Severity,
				"small_verdict": fmt.Sprintf("[%s 判定疑似攻击/风险] %s", smallModel, verdict.Summary),
			}).Error
		}
	} else if item.directToLarge {
		_ = DB.Model(&incident).Update("small_verdict", "🚨 高危入侵/篡改事件：已跳过初筛直接唤醒高级安全专家取证！").Error
	}

	if largeURL == "" || largeKey == "" || largeModel == "" {
		_ = DB.Model(&incident).Updates(map[string]any{
			"status":       "error",
			"large_report": "未配置高级模型参数，请尽快人工核查：" + item.summary,
		}).Error
		ao.pushDiagnosisAlert(cfg, srv, fmt.Sprintf("🚨 安全警报 [%s]\n%s", srv.Name, item.summary))
		return
	}

	securityPrompt := fmt.Sprintf(`安全入侵哨兵在服务器 [%s] (server_id=%d) 捕获到以下安全事件，请你立即作为高级安全响应专家上机取证分析：
- 触发类型：%s
- 警报摘要：%s
- 初步现场取证快照：
%s

请你使用 exec_on_server 工具（server_id=%d）按需进一步核查：
- 如果是陌生 SSH 登录或文件篡改：查清登录者 IP、当前正在执行什么命令、是否修改了 authorized_keys / passwd / crontab / systemd 服务，评估是否是管理员本人还是入侵者；
- 如果是疑似数据外泄：查清是哪个具体进程/PID 正在往哪个目标 IP:端口 大量外发数据；
- 如果是疑似网站被攻击：查清排名前列的攻击源 IP、被打的端口或网站域名路径。

请输出清晰的中文 Markdown 安全取证报告，包含：【风险定级与结论】、【攻击源 / 可疑进程取证详情】、【一键封禁 / 处置建议】。
若经你上机核查确认本次事件纯属正常面板/系统定时任务（如宝塔、1Panel、acme.sh、apt 更新）或误报、无任何入侵迹象，请在报告最末尾单独附上一行标记：[BENIGN_CHANGE]`,
		srv.Name, srv.ID, item.triggerType, item.summary, forensicOut, srv.ID)

	invCtx, invCancel := context.WithTimeout(context.Background(), 4*time.Minute)
	report, steps, lErr := ao.runAgentReActLoop(
		invCtx,
		largeURL,
		largeKey,
		largeModel,
		[]llmChatMessage{{Role: "user", Content: securityPrompt}},
		!cfg.AutoSelfHeal,
		nil,
	)
	invCancel()

	stepsBytes, _ := json.Marshal(steps)
	if lErr != nil {
		_ = DB.Model(&incident).Updates(map[string]any{
			"status":          "error",
			"large_report":    "高级模型取证失败: " + lErr.Error(),
			"tool_steps_json": string(stepsBytes),
		}).Error
		ao.pushDiagnosisAlert(cfg, srv, fmt.Sprintf("🚨 安全警报 [%s]\n%s", srv.Name, item.summary))
		return
	}

	isBenign := strings.Contains(report, "[BENIGN_CHANGE]") ||
		(strings.Contains(report, "误报") && (strings.Contains(report, "未发现入侵") || strings.Contains(report, "不是入侵")))
	report = strings.TrimSpace(strings.ReplaceAll(report, "[BENIGN_CHANGE]", ""))

	finalStatus := "reported"
	if cfg.AutoSelfHeal {
		finalStatus = "healed"
	}
	updates := map[string]any{
		"status":          finalStatus,
		"large_report":    report,
		"tool_steps_json": string(stepsBytes),
	}
	if isBenign {
		updates["severity"] = "low"
		updates["small_verdict"] = "✅ 高级安全专家上机复核确认：属于正常面板/系统维护变更，已排除入侵风险（免打扰不推送警报）"
	}
	_ = DB.Model(&incident).Updates(updates).Error

	if isBenign {
		return
	}

	pushBody := fmt.Sprintf("🚨 AI 安全哨兵警报 [%s]\n%s\n\n%s", srv.Name, item.summary, report)
	if len([]rune(pushBody)) > 1200 {
		pushBody = string([]rune(pushBody)[:1200]) + "\n...(完整取证报告与一键处置按钮请登录面板 AI 运维助手查看)"
	}
	ao.pushDiagnosisAlert(cfg, srv, pushBody)
}
