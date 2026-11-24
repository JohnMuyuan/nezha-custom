package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/tsdb"
)

func TestComputeLatencyCellStats_StableVsUnstable(t *testing.T) {
	now := time.Now().Truncate(time.Minute)
	start := now.Add(-1 * time.Hour)
	bucketMs := int64(90 * 1000)

	// Server A: rock-solid US node (~150ms, tiny jitter, 0% loss)
	stablePts := make([]tsdb.RawServicePoint, 0, 20)
	for i := range 20 {
		delay := 150.0
		if i%2 == 0 {
			delay = 151.0
		}
		stablePts = append(stablePts, tsdb.RawServicePoint{
			Timestamp: start.Add(time.Duration(i*3) * time.Minute).UnixMilli(),
			Delay:     delay,
			Status:    1,
			HasDelay:  true,
			HasStatus: true,
		})
	}
	stableCell := computeLatencyCellStats(stablePts, start.UnixMilli(), now.UnixMilli(), bucketMs)
	require.NotNil(t, stableCell)
	require.NotNil(t, stableCell.AvgMs)
	require.NotNil(t, stableCell.JitterMs)
	assert.InDelta(t, 150.5, *stableCell.AvgMs, 0.1)
	assert.InDelta(t, 1.0, *stableCell.JitterMs, 0.1)
	assert.Equal(t, 0.0, stableCell.LossPercent)
	assert.GreaterOrEqual(t, stableCell.StabilityScore, 95.0, "steady 150ms node with 0% loss must score very stable")
	assert.NotEmpty(t, stableCell.Sparkline)

	// Server B: nearby HK node with lower average latency (~90ms) but heavy jitter + 15% packet loss
	unstablePts := make([]tsdb.RawServicePoint, 0, 20)
	delays := []float64{30, 180, 35, 210, 0, 40, 195, 32, 0, 220, 38, 175, 42, 240, 0, 36, 190, 44, 205, 39}
	for i, d := range delays {
		ok := d > 0
		st := 1.0
		if !ok {
			st = 0.0
		}
		unstablePts = append(unstablePts, tsdb.RawServicePoint{
			Timestamp: start.Add(time.Duration(i*3) * time.Minute).UnixMilli(),
			Delay:     d,
			Status:    st,
			HasDelay:  ok,
			HasStatus: true,
		})
	}
	unstableCell := computeLatencyCellStats(unstablePts, start.UnixMilli(), now.UnixMilli(), bucketMs)
	require.NotNil(t, unstableCell)
	require.NotNil(t, unstableCell.AvgMs)
	require.NotNil(t, unstableCell.JitterMs)
	require.NotNil(t, unstableCell.P95Ms)
	assert.Less(t, *unstableCell.AvgMs, *stableCell.AvgMs, "unstable node still has lower mean latency")
	assert.Equal(t, 15.0, unstableCell.LossPercent)
	assert.Greater(t, *unstableCell.JitterMs, 100.0)
	assert.Less(t, unstableCell.StabilityScore, 30.0, "heavy jitter + 15% packet loss must produce very low stability score")
	assert.Less(t, unstableCell.StabilityScore, stableCell.StabilityScore)
}

func TestParseLatencyOverviewPeriodAndGuestGuard(t *testing.T) {
	p1h, err := parseLatencyOverviewPeriod("")
	require.NoError(t, err)
	assert.Equal(t, "1h", p1h.name)
	assert.False(t, p1h.requiresLogin)

	p6h, err := parseLatencyOverviewPeriod("6h")
	require.NoError(t, err)
	assert.Equal(t, 6*time.Hour, p6h.duration)
	assert.False(t, p6h.requiresLogin)

	p1d, err := parseLatencyOverviewPeriod("1d")
	require.NoError(t, err)
	assert.Equal(t, 24*time.Hour, p1d.duration)
	assert.False(t, p1d.requiresLogin)

	p7d, err := parseLatencyOverviewPeriod("7d")
	require.NoError(t, err)
	assert.True(t, p7d.requiresLogin)

	_, err = parseLatencyOverviewPeriod("99d")
	assert.Error(t, err)

	// Guest requesting 7d must be rejected
	ensureLocalizerForStreamTests(t)
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/service/latency-overview?period=7d", nil)
	_, err = getLatencyOverview(c)
	assert.Error(t, err)
}

func TestServiceCoversServer(t *testing.T) {
	coverAll := &model.Service{
		Cover:       model.ServiceCoverAll,
		SkipServers: map[uint64]bool{2: true},
	}
	assert.True(t, serviceCoversServer(coverAll, 1))
	assert.False(t, serviceCoversServer(coverAll, 2))

	ignoreAll := &model.Service{
		Cover:       model.ServiceCoverIgnoreAll,
		SkipServers: map[uint64]bool{3: true},
	}
	assert.False(t, serviceCoversServer(ignoreAll, 1))
	assert.True(t, serviceCoversServer(ignoreAll, 3))
}
