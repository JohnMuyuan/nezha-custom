package singleton

import (
	"testing"

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
