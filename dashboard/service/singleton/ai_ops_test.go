package singleton

import (
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
)

func TestValidateAICommandSafety(t *testing.T) {
	redLineCases := []string{
		"systemctl stop nezha-agent",
		"sudo systemctl restart nezha-agent.service",
		"pkill -9 nezha-agent",
		"rm -rf /opt/nezha/agent",
		"rm -rf /",
		"rm -rf /*",
		"mkfs.ext4 /dev/vda1",
		"dd if=/dev/zero of=/dev/sda bs=1M",
		"shutdown -h now",
		"poweroff",
		"iptables -P INPUT DROP",
		"ip link set eth0 down",
	}
	for _, cmd := range redLineCases {
		if err := ValidateAICommandSafety(cmd, false); err == nil {
			t.Fatalf("expected red-line command %q to be blocked in autonomous mode", cmd)
		}
		if err := ValidateAICommandSafety(cmd, true); err == nil {
			t.Fatalf("expected red-line command %q to be blocked in readOnly mode", cmd)
		}
	}

	autonomousAllowed := []string{
		"systemctl status nezha-agent",
		"cd /opt/apps/caddy && docker compose pull && docker compose up -d",
		"docker restart nginx",
		"docker image prune -f",
		"journalctl --vacuum-size=100M",
		"rm -f /var/log/nginx/old.log",
	}
	for _, cmd := range autonomousAllowed {
		if err := ValidateAICommandSafety(cmd, false); err != nil {
			t.Fatalf("expected safe ops command %q to be allowed in autonomous mode, got: %v", cmd, err)
		}
	}

	readOnlyBlocked := []string{
		"docker restart nginx",
		"cd /opt/apps && docker compose up -d",
		"rm -f /tmp/foo",
		"systemctl restart nginx",
		"apt-get upgrade -y",
	}
	for _, cmd := range readOnlyBlocked {
		if err := ValidateAICommandSafety(cmd, true); err == nil {
			t.Fatalf("expected mutating command %q to be blocked in readOnly mode", cmd)
		}
	}

	readOnlyAllowed := []string{
		"uptime && free -m && df -h",
		"docker ps -a --format '{{.Names}} {{.Status}}'",
		"docker logs --tail 60 caddy",
		"ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -n 15",
		"systemctl status nezha-agent --no-pager",
	}
	for _, cmd := range readOnlyAllowed {
		if err := ValidateAICommandSafety(cmd, true); err != nil {
			t.Fatalf("expected diagnostic command %q to be allowed in readOnly mode, got: %v", cmd, err)
		}
	}
}

func TestNormalizeOpenAIChatURL(t *testing.T) {
	cases := map[string]string{
		"https://api.deepseek.com":                                   "https://api.deepseek.com/v1/chat/completions",
		"https://api.siliconflow.cn/v1/":                             "https://api.siliconflow.cn/v1/chat/completions",
		"https://openrouter.ai/api/v1":                               "https://openrouter.ai/api/v1/chat/completions",
		"https://generativelanguage.googleapis.com/v1beta/openai":    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
		"https://dashscope.aliyuncs.com/compatible-mode/v1":          "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
		"https://my-relay.example.com/v1/chat/completions":           "https://my-relay.example.com/v1/chat/completions",
	}
	for in, want := range cases {
		if got := NormalizeOpenAIChatURL(in); got != want {
			t.Errorf("NormalizeOpenAIChatURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseSmallTriageVerdictAndMasking(t *testing.T) {
	raw := "<think>Checking metrics...</think>\n```json\n{\"escalate\": false, \"severity\": \"low\", \"summary\": \"短暂备份波动，无需打扰\"}\n```"
	v := parseSmallTriageVerdict(raw)
	if v.Escalate || v.Severity != "low" || v.Summary != "短暂备份波动，无需打扰" {
		t.Fatalf("unexpected verdict: %+v", v)
	}

	masked := model.MaskSecret("sk-abcdef1234567890xyz")
	if masked != "sk-a••••••••0xyz" {
		t.Fatalf("unexpected mask: %s", masked)
	}
	if !model.IsMaskedUnchanged(masked, "sk-abcdef1234567890xyz") {
		t.Fatal("expected masked placeholder to be treated as unchanged")
	}
	if model.IsMaskedUnchanged("sk-newkey9999999999", "sk-abcdef1234567890xyz") {
		t.Fatal("expected new key to be detected as changed")
	}

	ids := parseAllowedTelegramIDs("123456789, -100998877， 556677")
	if len(ids) != 3 {
		t.Fatalf("expected 3 parsed Telegram IDs, got %d", len(ids))
	}
}

func TestSecuritySentinelProbeAndDiff(t *testing.T) {
	allow := "23.147.56.205, 10.8.0.0/16"
	if !isTrustedSSHIP("23.147.56.205", allow) {
		t.Fatal("expected exact allowlist IP to be trusted")
	}
	if !isTrustedSSHIP("10.8.4.99", allow) {
		t.Fatal("expected CIDR allowlist IP to be trusted")
	}
	if !isTrustedSSHIP("127.0.0.1", "") {
		t.Fatal("expected loopback IP to be trusted")
	}
	if isTrustedSSHIP("185.220.101.9", allow) {
		t.Fatal("expected unknown external IP to be untrusted")
	}

	baselineRaw := `===WHO===
root     pts/0        2026-11-22 10:00 (tmux(1234).%0)
root     pts/1        2026-11-22 10:01 (23.147.56.205)
===AUTH_ACCEPTED===
Nov 22 10:01:02 vps sshd[999]: Accepted publickey for root from 23.147.56.205 port 51234 ssh2
===HASHES===
1111111111111111111111111111111111111111111111111111111111111111  /root/.ssh/authorized_keys
2222222222222222222222222222222222222222222222222222222222222222  /etc/passwd
MISSING /etc/ld.so.preload
===BRUTE_10M===
12`

	ao := &AIOpsClass{
		securityStates:   make(map[uint64]*serverSecurityState),
		securityCooldown: make(map[string]time.Time),
	}
	srv := &model.Server{Common: model.Common{ID: 8}, Name: "HK-Node"}
	cfg := model.AIOpsConfig{
		SecurityEnabled: true,
		TrustedSSHIPS:   allow,
	}

	// 1. First scan establishes baseline silently (0 alerts)
	parsedBase := parseSecurityProbeOutput(baselineRaw)
	if len(parsedBase.ActiveSSH) != 1 { // tmux session ignored, real IP kept
		t.Fatalf("expected 1 active remote SSH session, got %d", len(parsedBase.ActiveSSH))
	}
	initialAlerts := ao.diffServerSecurityFingerprint(srv, parsedBase, cfg, time.Now())
	if len(initialAlerts) != 0 {
		t.Fatalf("expected 0 alerts on initial baseline, got %d", len(initialAlerts))
	}

	// 2. Trusted admin login from CIDR does NOT alert
	trustedNext := parseSecurityProbeOutput(`===WHO===
root     pts/2        2026-11-22 10:06 (10.8.1.2)
===AUTH_ACCEPTED===
Nov 22 10:06:00 vps sshd[1002]: Accepted publickey for root from 10.8.1.2 port 55111 ssh2
===HASHES===
1111111111111111111111111111111111111111111111111111111111111111  /root/.ssh/authorized_keys
2222222222222222222222222222222222222222222222222222222222222222  /etc/passwd
MISSING /etc/ld.so.preload
===BRUTE_10M===
15`)
	if got := ao.diffServerSecurityFingerprint(srv, trustedNext, cfg, time.Now()); len(got) != 0 {
		t.Fatalf("expected 0 alerts for trusted IP login, got %+v", got)
	}

	// 3. Untrusted SSH login + authorized_keys modification fires BOTH security_ssh and security_tamper!
	intrusionRaw := parseSecurityProbeOutput(`===WHO===
root     pts/3        2026-11-22 10:09 (185.220.101.9)
===AUTH_ACCEPTED===
Nov 22 10:09:01 vps sshd[1055]: Accepted password for root from 185.220.101.9 port 44321 ssh2
===HASHES===
9999999999999999999999999999999999999999999999999999999999999999  /root/.ssh/authorized_keys
2222222222222222222222222222222222222222222222222222222222222222  /etc/passwd
MISSING /etc/ld.so.preload
===BRUTE_10M===
20`)
	alerts := ao.diffServerSecurityFingerprint(srv, intrusionRaw, cfg, time.Now())
	if len(alerts) != 2 {
		t.Fatalf("expected 2 high-risk security alerts (ssh + tamper), got %d: %+v", len(alerts), alerts)
	}
	if alerts[0].triggerType != "security_ssh" || !alerts[0].directToLarge {
		t.Fatalf("expected first alert to be directToLarge security_ssh, got %+v", alerts[0])
	}
	if alerts[1].triggerType != "security_tamper" || !alerts[1].directToLarge {
		t.Fatalf("expected second alert to be directToLarge security_tamper, got %+v", alerts[1])
	}
}
