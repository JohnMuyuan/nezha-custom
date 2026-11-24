package controller

import (
	"cmp"
	"fmt"
	"math"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/tsdb"
	"github.com/nezhahq/nezha/service/singleton"
)

const (
	latencyOverviewCacheTTL       = 15 * time.Second
	latencyOverviewSparklineCount = 40
	latencyOverviewOnlineWindow   = 30 * time.Second
)

type latencyPeriodSpec struct {
	name          string
	duration      time.Duration
	requiresLogin bool
}

var latencyPeriodSpecs = map[string]latencyPeriodSpec{
	"1h": {name: "1h", duration: 1 * time.Hour, requiresLogin: false},
	"6h": {name: "6h", duration: 6 * time.Hour, requiresLogin: false},
	"1d": {name: "1d", duration: 24 * time.Hour, requiresLogin: false},
	"7d": {name: "7d", duration: 7 * 24 * time.Hour, requiresLogin: true},
}

type cachedLatencyOverview struct {
	resp      *model.LatencyOverviewResponse
	expiresAt time.Time
}

var (
	latencyOverviewCacheMu sync.RWMutex
	latencyOverviewCache   = make(map[string]cachedLatencyOverview)
)

func parseLatencyOverviewPeriod(raw string) (latencyPeriodSpec, error) {
	if raw == "" {
		return latencyPeriodSpecs["1h"], nil
	}
	spec, ok := latencyPeriodSpecs[raw]
	if !ok {
		return latencyPeriodSpec{}, fmt.Errorf("invalid period: %s, expected 1h, 6h, 1d, or 7d", raw)
	}
	return spec, nil
}

// Get latency overview matrix across all visible servers and service monitors.
// @Summary Get all-server latency and stability overview matrix
// @Security BearerAuth
// @Schemes
// @Description Aggregated latency, jitter, packet loss, stability score, and sparklines across all visible servers and monitors
// @Tags common
// @Param period query string false "Time period: 1h, 6h, 1d, 7d (default: 1h)"
// @Produce json
// @Success 200 {object} model.CommonResponse[model.LatencyOverviewResponse]
// @Router /service/latency-overview [get]
func getLatencyOverview(c *gin.Context) (*model.LatencyOverviewResponse, error) {
	spec, err := parseLatencyOverviewPeriod(c.DefaultQuery("period", "1h"))
	if err != nil {
		return nil, err
	}

	_, isMember := c.Get(model.CtxKeyAuthorizedUser)
	if spec.requiresLogin && !isMember {
		return nil, singleton.Localizer.ErrorT("unauthorized: only up to 1d data available for guests")
	}

	cacheKey := fmt.Sprintf("latency-overview::%s::%s", spec.name, serviceResponseCacheKey(c))
	now := time.Now()

	latencyOverviewCacheMu.RLock()
	if cached, ok := latencyOverviewCache[cacheKey]; ok && now.Before(cached.expiresAt) {
		latencyOverviewCacheMu.RUnlock()
		return cached.resp, nil
	}
	latencyOverviewCacheMu.RUnlock()

	v, err, _ := requestGroup.Do(cacheKey, func() (any, error) {
		resp, err := buildLatencyOverview(c, spec, time.Now())
		if err != nil {
			return nil, err
		}
		latencyOverviewCacheMu.Lock()
		// Keep cache bounded if many distinct tokens hit it.
		if len(latencyOverviewCache) > 64 {
			cutoff := time.Now()
			for k, item := range latencyOverviewCache {
				if cutoff.After(item.expiresAt) {
					delete(latencyOverviewCache, k)
				}
			}
		}
		latencyOverviewCache[cacheKey] = cachedLatencyOverview{
			resp:      resp,
			expiresAt: time.Now().Add(latencyOverviewCacheTTL),
		}
		latencyOverviewCacheMu.Unlock()
		return resp, nil
	})
	if err != nil {
		return nil, err
	}
	return v.(*model.LatencyOverviewResponse), nil
}

func serviceCoversServer(service *model.Service, serverID uint64) bool {
	if service == nil {
		return false
	}
	if service.Cover == model.ServiceCoverAll {
		return !service.SkipServers[serverID]
	}
	return service.SkipServers[serverID]
}

func buildLatencyOverview(c *gin.Context, spec latencyPeriodSpec, now time.Time) (*model.LatencyOverviewResponse, error) {
	allServices := singleton.ServiceSentinelShared.GetSortedList()
	visibleServices := make([]*model.Service, 0, len(allServices))
	for _, s := range allServices {
		if s != nil && userCanViewService(c, s) {
			visibleServices = append(visibleServices, s)
		}
	}

	allServers := singleton.ServerShared.GetSortedList()
	visibleServers := make([]*model.Server, 0, len(allServers))
	for _, srv := range allServers {
		if srv != nil && userCanViewServer(c, srv) {
			visibleServers = append(visibleServers, srv)
		}
	}

	bucketMs := max(int64(spec.duration.Milliseconds())/latencyOverviewSparklineCount, int64(30*1000))
	since := now.Add(-spec.duration)

	resp := &model.LatencyOverviewResponse{
		Period:      spec.name,
		GeneratedAt: now.UnixMilli(),
		BucketMs:    bucketMs,
		Monitors:    make([]model.LatencyOverviewMonitor, 0, len(visibleServices)),
		Servers:     make([]model.LatencyOverviewServer, 0, len(visibleServers)),
	}

	for _, s := range visibleServices {
		resp.Monitors = append(resp.Monitors, model.LatencyOverviewMonitor{
			ID:           s.ID,
			Name:         s.Name,
			DisplayIndex: s.DisplayIndex,
		})
	}

	if len(visibleServices) == 0 || len(visibleServers) == 0 {
		for _, srv := range visibleServers {
			resp.Servers = append(resp.Servers, newLatencyOverviewServerShell(srv, now))
		}
		return resp, nil
	}

	var rawByServer map[uint64]map[uint64][]tsdb.RawServicePoint
	var err error
	if singleton.TSDBEnabled() {
		rawByServer, err = singleton.TSDBShared.QueryAllServiceRawPoints(since, now)
	} else {
		rawByServer, err = queryAllServiceRawPointsFromDB(since)
	}
	if err != nil {
		return nil, err
	}

	for _, srv := range visibleServers {
		row := newLatencyOverviewServerShell(srv, now)
		serverPoints := rawByServer[srv.ID]

		var avgSum, latestSum, p95Sum, jitterSum, lossSum, stabilitySum float64
		var avgCnt, latestCnt, p95Cnt, jitterCnt, cellCnt int

		for _, svc := range visibleServices {
			if !serviceCoversServer(svc, srv.ID) {
				continue
			}
			pts := serverPoints[svc.ID]
			if len(pts) == 0 {
				continue
			}
			cell := computeLatencyCellStats(pts, since.UnixMilli(), now.UnixMilli(), bucketMs)
			if cell == nil {
				continue
			}
			row.Cells[svc.ID] = cell
			cellCnt++
			lossSum += cell.LossPercent
			stabilitySum += cell.StabilityScore
			if cell.AvgMs != nil {
				avgSum += *cell.AvgMs
				avgCnt++
			}
			if cell.LatestMs != nil {
				latestSum += *cell.LatestMs
				latestCnt++
			}
			if cell.P95Ms != nil {
				p95Sum += *cell.P95Ms
				p95Cnt++
			}
			if cell.JitterMs != nil {
				jitterSum += *cell.JitterMs
				jitterCnt++
			}
		}

		row.MonitorCount = cellCnt
		if cellCnt > 0 {
			row.LossPercent = round2(lossSum / float64(cellCnt))
			score := round1(stabilitySum / float64(cellCnt))
			row.StabilityScore = &score
		}
		if avgCnt > 0 {
			v := round2(avgSum / float64(avgCnt))
			row.AvgMs = &v
		}
		if latestCnt > 0 {
			v := round2(latestSum / float64(latestCnt))
			row.LatestMs = &v
		}
		if p95Cnt > 0 {
			v := round2(p95Sum / float64(p95Cnt))
			row.P95Ms = &v
		}
		if jitterCnt > 0 {
			v := round2(jitterSum / float64(jitterCnt))
			row.JitterMs = &v
		}

		resp.Servers = append(resp.Servers, row)
	}

	return resp, nil
}

func newLatencyOverviewServerShell(srv *model.Server, now time.Time) model.LatencyOverviewServer {
	runtime := srv.RuntimeSnapshot()
	var countryCode string
	if srv.GeoIP != nil {
		countryCode = srv.GeoIP.CountryCode
	}
	online := !runtime.LastActive.IsZero() && now.Sub(runtime.LastActive) <= latencyOverviewOnlineWindow
	return model.LatencyOverviewServer{
		ID:           srv.ID,
		Name:         srv.Name,
		CountryCode:  countryCode,
		DisplayIndex: srv.DisplayIndex,
		Online:       online,
		Cells:        make(map[uint64]*model.LatencyCellStats),
	}
}

func queryAllServiceRawPointsFromDB(since time.Time) (map[uint64]map[uint64][]tsdb.RawServicePoint, error) {
	var histories []model.ServiceHistory
	if err := singleton.DB.Where("server_id != 0 AND created_at >= ?", since).
		Order("server_id, service_id, created_at").Find(&histories).Error; err != nil {
		return nil, err
	}

	out := make(map[uint64]map[uint64][]tsdb.RawServicePoint)
	for _, h := range histories {
		if out[h.ServerID] == nil {
			out[h.ServerID] = make(map[uint64][]tsdb.RawServicePoint)
		}
		ts := h.CreatedAt.UnixMilli()
		hasStatus := h.Up+h.Down > 0
		statusVal := 1.0
		if hasStatus {
			statusVal = float64(h.Up) / float64(h.Up+h.Down)
		} else if h.AvgDelay <= 0 {
			hasStatus = true
			statusVal = 0
		}
		out[h.ServerID][h.ServiceID] = append(out[h.ServerID][h.ServiceID], tsdb.RawServicePoint{
			Timestamp: ts,
			Delay:     model.FiniteStateValue(h.AvgDelay),
			Status:    statusVal,
			HasDelay:  h.AvgDelay > 0,
			HasStatus: hasStatus,
		})
	}
	return out, nil
}

// computeLatencyCellStats aggregates raw points for one (server, monitor) pair into
// latency percentiles, jitter, std dev, packet loss, stability score (0-100), and
// an aligned downsampled sparkline.
func computeLatencyCellStats(points []tsdb.RawServicePoint, startMs, endMs, bucketMs int64) *model.LatencyCellStats {
	if len(points) == 0 {
		return nil
	}

	ordered := points
	if !slices.IsSortedFunc(points, func(a, b tsdb.RawServicePoint) int {
		return cmp.Compare(a.Timestamp, b.Timestamp)
	}) {
		ordered = slices.Clone(points)
		sort.Slice(ordered, func(i, j int) bool {
			return ordered[i].Timestamp < ordered[j].Timestamp
		})
	}

	validDelays := make([]float64, 0, len(ordered))
	var sumDelay float64
	var minDelay, maxDelay float64
	var latestDelay float64
	hasLatest := false

	var jitterDeltaSum float64
	var jitterDeltaCount int
	prevDelay := 0.0
	hasPrevDelay := false

	var upWeight, downWeight float64
	var statusSamples int

	for _, p := range ordered {
		sampleFailed := false
		if p.HasStatus {
			statusSamples++
			// Supports both binary TSDB status (0/1) and fractional SQLite ratio (up/(up+down)).
			clamped := math.Max(0, math.Min(1, p.Status))
			upWeight += clamped
			downWeight += 1 - clamped
			if clamped < 0.5 {
				sampleFailed = true
			}
		}

		isValidDelay := p.HasDelay && p.Delay > 0 && !math.IsNaN(p.Delay) && !math.IsInf(p.Delay, 0) && !sampleFailed
		if !p.HasStatus {
			// Fallback when only delay samples exist: delay <= 0 indicates timeout/failure.
			statusSamples++
			if isValidDelay {
				upWeight += 1
			} else {
				downWeight += 1
			}
		}

		if isValidDelay {
			if len(validDelays) == 0 {
				minDelay = p.Delay
				maxDelay = p.Delay
			} else {
				if p.Delay < minDelay {
					minDelay = p.Delay
				}
				if p.Delay > maxDelay {
					maxDelay = p.Delay
				}
			}
			validDelays = append(validDelays, p.Delay)
			sumDelay += p.Delay
			latestDelay = p.Delay
			hasLatest = true
			if hasPrevDelay {
				jitterDeltaSum += math.Abs(p.Delay - prevDelay)
				jitterDeltaCount++
			}
			prevDelay = p.Delay
			hasPrevDelay = true
		}
	}

	cell := &model.LatencyCellStats{
		SampleCount: len(ordered),
		Sparkline:   buildLatencySparkline(ordered, startMs, endMs, bucketMs),
	}

	if statusSamples > 0 && (upWeight+downWeight) > 0 {
		cell.LossPercent = round2((downWeight / (upWeight + downWeight)) * 100)
	}

	var avgVal, p95Val, jitterVal, stdDevVal float64
	if len(validDelays) > 0 {
		avgVal = sumDelay / float64(len(validDelays))
		var varianceSum float64
		for _, d := range validDelays {
			diff := d - avgVal
			varianceSum += diff * diff
		}
		stdDevVal = math.Sqrt(varianceSum / float64(len(validDelays)))
		if jitterDeltaCount > 0 {
			jitterVal = jitterDeltaSum / float64(jitterDeltaCount)
		}

		sortedDelays := slices.Clone(validDelays)
		sort.Float64s(sortedDelays)
		p95Idx := int(math.Ceil(0.95*float64(len(sortedDelays)))) - 1
		if p95Idx < 0 {
			p95Idx = 0
		}
		if p95Idx >= len(sortedDelays) {
			p95Idx = len(sortedDelays) - 1
		}
		p95Val = sortedDelays[p95Idx]

		avgR := round2(avgVal)
		minR := round2(minDelay)
		maxR := round2(maxDelay)
		p95R := round2(p95Val)
		jitterR := round2(jitterVal)
		stdDevR := round2(stdDevVal)
		cell.AvgMs = &avgR
		cell.MinMs = &minR
		cell.MaxMs = &maxR
		cell.P95Ms = &p95R
		cell.JitterMs = &jitterR
		cell.StdDevMs = &stdDevR
	}
	if hasLatest {
		latestR := round2(latestDelay)
		cell.LatestMs = &latestR
	}

	cell.StabilityScore = computeStabilityScore(len(validDelays) > 0, avgVal, p95Val, jitterVal, stdDevVal, cell.LossPercent)
	return cell
}

// computeStabilityScore rates link steadiness from 0 (extremely unstable / down) to 100 (rock solid).
// Deliberately decouples steadiness from base geographic latency: a 160ms US line with ±1ms jitter
// and 0% loss scores ~99, while a 35ms line bouncing ±30ms with 4% loss drops sharply into warning/critical.
func computeStabilityScore(hasValidDelay bool, avgMs, p95Ms, jitterMs, stdDevMs, lossPercent float64) float64 {
	if !hasValidDelay {
		return 0
	}
	score := 100.0

	// 1. Packet loss penalty (most disruptive to interactive & streaming traffic)
	score -= math.Min(70.0, lossPercent*12.0)

	// 2. Absolute consecutive jitter penalty
	score -= math.Min(25.0, jitterMs*0.45)

	// 3. Relative dispersion (CV = stdDev / max(avg, 10ms)) so jitter on low-latency nodes is caught
	denom := math.Max(avgMs, 10.0)
	cv := stdDevMs / denom
	score -= math.Min(20.0, cv*35.0)

	// 4. Tail-spike penalty (P95 significantly above mean)
	if p95Ms > avgMs*1.4 && (p95Ms-avgMs) > 20.0 {
		score -= math.Min(15.0, (p95Ms-avgMs)*0.12)
	}

	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return round1(score)
}

func buildLatencySparkline(ordered []tsdb.RawServicePoint, startMs, endMs, bucketMs int64) []model.LatencySparkPoint {
	if len(ordered) == 0 || bucketMs <= 0 {
		return nil
	}
	type bucketAgg struct {
		delaySum   float64
		delayCount int
		upWeight   float64
		downWeight float64
		statusCnt  int
	}
	buckets := make(map[int64]*bucketAgg)
	keys := make([]int64, 0, latencyOverviewSparklineCount)

	for _, p := range ordered {
		if p.Timestamp < startMs || p.Timestamp > endMs+bucketMs {
			continue
		}
		key := (p.Timestamp / bucketMs) * bucketMs
		agg := buckets[key]
		if agg == nil {
			agg = &bucketAgg{}
			buckets[key] = agg
			keys = append(keys, key)
		}
		failed := false
		if p.HasStatus {
			clamped := math.Max(0, math.Min(1, p.Status))
			agg.upWeight += clamped
			agg.downWeight += 1 - clamped
			agg.statusCnt++
			if clamped < 0.5 {
				failed = true
			}
		}
		isValid := p.HasDelay && p.Delay > 0 && !math.IsNaN(p.Delay) && !math.IsInf(p.Delay, 0) && !failed
		if !p.HasStatus {
			agg.statusCnt++
			if isValid {
				agg.upWeight += 1
			} else {
				agg.downWeight += 1
			}
		}
		if isValid {
			agg.delaySum += p.Delay
			agg.delayCount++
		}
	}

	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	spark := make([]model.LatencySparkPoint, 0, len(keys))
	for _, k := range keys {
		agg := buckets[k]
		var delayPtr *float64
		if agg.delayCount > 0 {
			v := round2(agg.delaySum / float64(agg.delayCount))
			delayPtr = &v
		}
		loss := 0.0
		if agg.statusCnt > 0 && (agg.upWeight+agg.downWeight) > 0 {
			loss = round2((agg.downWeight / (agg.upWeight + agg.downWeight)) * 100)
		}
		spark = append(spark, model.LatencySparkPoint{
			Timestamp: k,
			Delay:     delayPtr,
			Loss:      loss,
		})
	}
	return spark
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
