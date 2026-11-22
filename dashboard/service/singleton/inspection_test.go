package singleton

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
)

func TestParseMediaUnlockOutput(t *testing.T) {
	raw := `
STACK|v4|1
MEDIA|v4|netflix|full|US
MEDIA|v4|disney|yes|US
MEDIA|v4|youtube|cn|CN
MEDIA|v4|chatgpt|yes|US
MEDIA|v4|claude|no|HK
STACK|v6|1
MEDIA|v6|netflix|originals|
MEDIA|v6|claude|yes|JP
`
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	report := ParseMediaUnlockOutput(raw, []string{"netflix", "disney", "youtube", "chatgpt", "claude"}, now)
	require.True(t, report.IPv4Available)
	require.True(t, report.IPv6Available)
	require.Len(t, report.IPv4, 5)
	require.Equal(t, "full", report.IPv4[0].Status)
	require.Equal(t, "US", report.IPv4[0].Region)
	require.Equal(t, "cn", report.IPv4[2].Status)
	require.Equal(t, "ai", report.IPv4[3].Category)
	require.Len(t, report.IPv6, 2)
	require.Equal(t, "yes", report.IPv6[1].Status)
	require.Equal(t, "JP", report.IPv6[1].Region)
}

func TestParseBackhaulOutput(t *testing.T) {
	raw := `
TOOL|mtr
ROUTE|ct|202.96.209.133|10.0.0.1,59.43.187.1,59.43.246.10,202.96.209.133
ROUTE|cu|210.22.97.1|10.0.0.1,218.105.2.10,210.22.97.1
ROUTE|cm|211.136.112.200|10.0.0.1,223.120.2.50,221.183.55.1,211.136.112.200
`
	report := ParseBackhaulOutput(raw, time.Now())
	require.Equal(t, "mtr", report.Tool)
	require.Len(t, report.Routes, 3)
	require.Equal(t, "CN2 GIA", report.Routes[0].RouteType)
	require.Equal(t, "premium", report.Routes[0].Tier)
	require.Equal(t, "联通 AS9929", report.Routes[1].RouteType)
	require.Equal(t, "移动 CMI", report.Routes[2].RouteType)
}

func TestParseIPQualityOutput(t *testing.T) {
	raw := `
IPAPIIS|{"ip":"1.2.3.4","is_datacenter":true,"is_proxy":false,"is_vpn":false,"is_tor":false,"is_abuser":false,"is_mobile":false,"asn":{"asn":15169,"org":"Google LLC","type":"hosting"},"company":{"name":"Google","type":"hosting"},"location":{"country_code":"US","state":"California","city":"San Jose"}}
GOOGLE_REG|US
SMTP25|closed
DNSBL|checked|
`
	q := ParseIPQualityOutput(raw, time.Now())
	require.Equal(t, "1.2.3.4", q.IP)
	require.Equal(t, "AS15169", q.ASN)
	require.Equal(t, "datacenter", q.IPType)
	require.Equal(t, "low", q.RiskLevel)
	require.False(t, q.GoogleCN)
	require.NotNil(t, q.SMTP25Open)
	require.False(t, *q.SMTP25Open)
	require.NotNil(t, q.DNSBLClean)
	require.True(t, *q.DNSBLClean)
}

func TestInspectionHandleCommandResultRejectsSpoofing(t *testing.T) {
	ic := NewInspectionClass()
	taskID := inspectionTaskIDMask | 42
	ch := make(chan *pb.TaskResult, 1)
	ic.pending[taskID] = &pendingInspectionTask{serverID: 10, ch: ch}

	// Wrong server tries to spoof result for server 10
	handled := ic.HandleCommandResult(99, &pb.TaskResult{
		Id:         taskID,
		Type:       model.TaskTypeCommand,
		Successful: true,
		Data:       "spoofed",
	})
	require.True(t, handled)
	require.Len(t, ch, 0)

	// Genuine server 10 delivers result
	handled = ic.HandleCommandResult(10, &pb.TaskResult{
		Id:         taskID,
		Type:       model.TaskTypeCommand,
		Successful: true,
		Data:       "genuine",
	})
	require.True(t, handled)
	require.Len(t, ch, 1)
}

func TestParseBillingExpiryDays(t *testing.T) {
	loc := time.FixedZone("CST", 8*3600)
	now := time.Date(2026, 5, 1, 9, 0, 0, 0, loc)

	// 7 days left
	days, exp, amt, cyc, autoRen, ok := ParseBillingExpiryDays(`{"billingDataMod":{"endDate":"2026-05-08T00:00:00+08:00","autoRenewal":"0","cycle":"年","amount":"$20"}}`, now)
	require.True(t, ok)
	require.Equal(t, 7, days)
	require.Equal(t, "2026-05-08", exp.Format("2006-01-02"))
	require.Equal(t, "$20", amt)
	require.Equal(t, "年", cyc)
	require.False(t, autoRen)

	// Auto-renewal rolls past date forward by 1 month
	days, exp, _, _, autoRen, ok = ParseBillingExpiryDays(`{"billingDataMod":{"endDate":"2026-04-05T00:00:00+08:00","autoRenewal":"1","cycle":"月","amount":"¥30"}}`, now)
	require.True(t, ok)
	require.True(t, autoRen)
	require.Equal(t, 4, days)
	require.Equal(t, "2026-05-05", exp.Format("2006-01-02"))

	// Permanent machine skipped
	_, _, _, _, _, ok = ParseBillingExpiryDays(`{"billingDataMod":{"endDate":"0000-00-00T00:00:00+08:00","cycle":"年","amount":"$10"}}`, now)
	require.False(t, ok)
}

func TestShouldScheduleInspection(t *testing.T) {
	now := time.Date(2026, 5, 2, 16, 5, 0, 0, time.UTC)

	// Never checked -> due immediately
	require.True(t, shouldScheduleInspection(time.Time{}, now, 24))
	// Checked 12 hours ago -> not due
	require.False(t, shouldScheduleInspection(now.Add(-12*time.Hour), now, 24))
	// Checked 23h50m ago (finished 10m after yesterday's cron tick) -> due within 15m grace window (zero daily drift)
	require.True(t, shouldScheduleInspection(now.Add(-23*time.Hour-50*time.Minute), now, 24))
	// Disabled (interval=0) -> never auto-scheduled
	require.False(t, shouldScheduleInspection(time.Time{}, now, 0))
}

func TestIsMainlandChinaServer(t *testing.T) {
	require.True(t, IsMainlandChinaServer(&model.Server{GeoIP: &model.GeoIP{CountryCode: "CN"}}))
	require.True(t, IsMainlandChinaServer(&model.Server{GeoIP: &model.GeoIP{CountryCode: "cn"}}))
	require.False(t, IsMainlandChinaServer(&model.Server{GeoIP: &model.GeoIP{CountryCode: "HK"}}))
	require.False(t, IsMainlandChinaServer(&model.Server{GeoIP: &model.GeoIP{CountryCode: "TW"}}))
	require.False(t, IsMainlandChinaServer(&model.Server{GeoIP: &model.GeoIP{CountryCode: "US"}}))
	require.False(t, IsMainlandChinaServer(&model.Server{}))
	require.False(t, IsMainlandChinaServer(nil))
}
