package singleton

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/nezhahq/nezha/model"
)

func TestParseTrafficVolumeBytes(t *testing.T) {
	require.Equal(t, uint64(1)<<40, ParseTrafficVolumeBytes("1TB/Mouth"))
	require.Equal(t, uint64(2048)*(1<<30), ParseTrafficVolumeBytes("2048GB/Month"))
	require.Equal(t, uint64(500)*(1<<30), ParseTrafficVolumeBytes("500G"))
	require.Equal(t, uint64(0), ParseTrafficVolumeBytes("无限流量"))
	require.Equal(t, uint64(0), ParseTrafficVolumeBytes("Unlimited"))
	require.Equal(t, uint64(0), ParseTrafficVolumeBytes("-1"))
	require.Equal(t, uint64(0), ParseTrafficVolumeBytes(""))
}

func TestParseTrafficPlanFromPublicNoteTimezoneAndClamping(t *testing.T) {
	cst := time.FixedZone("CST", 8*3600)
	now := time.Date(2026, 11, 22, 16, 0, 0, 0, cst)

	// 2026-04-20T16:00:00.000Z in UTC == 2026-04-21 00:00:00 CST -> monthly reset on 21st!
	note := `{"billingDataMod":{"startDate":"2026-04-20T16:00:00.000Z","endDate":"2027-04-20T16:00:00.000Z","cycle":"Year","amount":"￥40"},"planDataMod":{"trafficVol":"1TB/Mouth","trafficType":"1"}}`
	maxB, tType, from, to := ParseTrafficPlanFromPublicNote(note, now)
	require.Equal(t, uint64(1)<<40, maxB)
	require.Equal(t, "max", tType)
	require.Equal(t, time.Date(2026, 11, 21, 0, 0, 0, 0, cst), from)
	require.Equal(t, time.Date(2026, 12, 21, 0, 0, 0, 0, cst), to)

	// Anchor on 31st clamps cleanly in February (non-leap 2026 -> Feb 28)
	febNow := time.Date(2026, 2, 15, 10, 0, 0, 0, cst)
	note31 := `{"billingDataMod":{"startDate":"2026-01-31T00:00:00+08:00"},"planDataMod":{"trafficVol":"500GB/Month","trafficType":"2"}}`
	_, tType31, from31, to31 := ParseTrafficPlanFromPublicNote(note31, febNow)
	require.Equal(t, "both", tType31)
	require.Equal(t, time.Date(2026, 1, 31, 0, 0, 0, 0, cst), from31)
	require.Equal(t, time.Date(2026, 2, 28, 0, 0, 0, 0, cst), to31)

	// Empty public_note falls back to natural month [1st, next 1st) with unlimited (0) quota
	maxEmpty, tTypeEmpty, fromEmpty, toEmpty := ParseTrafficPlanFromPublicNote("", now)
	require.Equal(t, uint64(0), maxEmpty)
	require.Equal(t, "both", tTypeEmpty)
	require.Equal(t, time.Date(2026, 11, 1, 0, 0, 0, 0, cst), fromEmpty)
	require.Equal(t, time.Date(2026, 12, 1, 0, 0, 0, 0, cst), toEmpty)
}

func TestCleanMonitorHistoryRetainsTransfersWhenAutoRecordEnabled(t *testing.T) {
	setupCleanMonitorHistoryTestDB(t)
	prevConf := Conf
	tc := model.DefaultThemeConfig()
	tc.TrafficBar.AutoRecord = true
	Conf = &ConfigClass{
		Config: &model.Config{
			ConfigForGuests: model.ConfigForGuests{
				ThemeConfig: tc,
			},
		},
	}
	t.Cleanup(func() { Conf = prevConf })

	now := time.Now().UTC()
	recent := model.Transfer{Common: model.Common{CreatedAt: now.Add(-10 * 24 * time.Hour)}, ServerID: 1, In: 1024}
	ancient := model.Transfer{Common: model.Common{CreatedAt: now.AddDate(0, 0, -450)}, ServerID: 1, In: 2048}
	require.NoError(t, DB.Create(&recent).Error)
	require.NoError(t, DB.Create(&ancient).Error)

	CleanMonitorHistory()

	var rows []model.Transfer
	require.NoError(t, DB.Find(&rows).Error)
	require.Len(t, rows, 1)
	require.Equal(t, recent.ID, rows[0].ID)
}
