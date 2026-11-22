package singleton

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/goccy/go-json"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/utils"
)

const (
	autoCycleIDBase   uint64 = 1_000_000
	autoCycleCacheTTL        = 30 * time.Minute
)

var (
	trafficVolRegex = regexp.MustCompile(`(?i)([0-9]+(?:\.[0-9]+)?)\s*(pb|tb|gb|mb|kb|p|t|g|m|k)`)

	autoCycleCacheMu sync.Mutex
	autoCycleCache   = make(map[uint64]cachedServerTransferSum)
)

type cachedServerTransferSum struct {
	fromUTC   int64
	toUTC     int64
	inBytes   uint64
	outBytes  uint64
	fetchedAt time.Time
}

type publicNoteTrafficMod struct {
	BillingDataMod *struct {
		StartDate string `json:"startDate"`
		EndDate   string `json:"endDate"`
		Cycle     string `json:"cycle"`
	} `json:"billingDataMod"`
	PlanDataMod *struct {
		TrafficVol  string `json:"trafficVol"`
		TrafficType string `json:"trafficType"`
	} `json:"planDataMod"`
}

// InvalidateAutoCycleTrafficCache clears cached SQLite sums when new hourly transfer rows are written.
func InvalidateAutoCycleTrafficCache() {
	autoCycleCacheMu.Lock()
	clear(autoCycleCache)
	autoCycleCacheMu.Unlock()
}

func daysInMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func makeClampedMonthDate(year int, month time.Month, anchorDay, hour, min, sec int, loc *time.Location) time.Time {
	// Normalize overflowing/underflowing month via time.Date with day=1 first
	first := time.Date(year, month, 1, 0, 0, 0, 0, loc)
	maxDay := daysInMonth(first.Year(), first.Month())
	day := anchorDay
	if day < 1 {
		day = 1
	} else if day > maxDay {
		day = maxDay
	}
	return time.Date(first.Year(), first.Month(), day, hour, min, sec, 0, loc)
}

func parseFlexibleNoteTime(raw string, loc *time.Location) (time.Time, bool) {
	s := strings.TrimSpace(raw)
	if s == "" || strings.HasPrefix(s, "0000-00-00") {
		return time.Time{}, false
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if strings.Contains(layout, "Z07:00") || layout == time.RFC3339 || layout == time.RFC3339Nano {
			if t, err := time.Parse(layout, s); err == nil && t.Year() >= 1990 {
				return t.In(loc), true
			}
		} else {
			if t, err := time.ParseInLocation(layout, s, loc); err == nil && t.Year() >= 1990 {
				return t, true
			}
		}
	}
	return time.Time{}, false
}

// ParseTrafficVolumeBytes parses human quota strings such as "1TB/Month", "1TB/Mouth",
// "2048GB/Month", "500G", "1.5T", or returns 0 for unlimited / unspecified quotas.
func ParseTrafficVolumeBytes(raw string) uint64 {
	s := strings.TrimSpace(raw)
	if s == "" || strings.HasPrefix(s, "-") {
		return 0
	}
	lower := strings.ToLower(s)
	if strings.Contains(lower, "无限") || strings.Contains(lower, "不限") || strings.Contains(lower, "unlimited") || strings.Contains(lower, "∞") {
		return 0
	}
	matches := trafficVolRegex.FindStringSubmatch(s)
	if len(matches) < 3 {
		return 0
	}
	val, err := strconv.ParseFloat(matches[1], 64)
	if err != nil || val <= 0 || math.IsNaN(val) || math.IsInf(val, 0) {
		return 0
	}
	unit := strings.ToLower(matches[2])
	var mult float64
	switch unit {
	case "pb", "p":
		mult = float64(uint64(1) << 50)
	case "tb", "t":
		mult = float64(uint64(1) << 40)
	case "gb", "g":
		mult = float64(uint64(1) << 30)
	case "mb", "m":
		mult = float64(uint64(1) << 20)
	case "kb", "k":
		mult = float64(uint64(1) << 10)
	default:
		return 0
	}
	product := val * mult
	if product >= float64(math.MaxUint64) {
		return math.MaxUint64
	}
	return uint64(math.Round(product))
}

func detectTrafficCycleUnit(trafficVol, billingCycle string) string {
	volLower := strings.ToLower(trafficVol)
	switch {
	case strings.Contains(volLower, "/year") || strings.Contains(volLower, "/yr") || strings.Contains(volLower, "/年"):
		return "year"
	case strings.Contains(volLower, "/week") || strings.Contains(volLower, "/wk") || strings.Contains(volLower, "/周"):
		return "week"
	case strings.Contains(volLower, "/day") || strings.Contains(volLower, "/天") || strings.Contains(volLower, "/日"):
		return "day"
	case strings.Contains(volLower, "/month") || strings.Contains(volLower, "/mouth") || strings.Contains(volLower, "/mo") || strings.Contains(volLower, "/月"):
		return "month"
	}
	cycLower := strings.ToLower(strings.TrimSpace(billingCycle))
	switch cycLower {
	case "day", "天", "日":
		return "day"
	case "week", "周":
		return "week"
	default:
		// Even yearly/quarterly VPS plans normally reset traffic monthly unless /Year is specified in trafficVol
		return "month"
	}
}

func normalizeTrafficType(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "single", "max", "单向":
		return "max"
	case "in", "inbound", "入站":
		return "in"
	case "out", "outbound", "出站":
		return "out"
	default:
		return "both"
	}
}

// ParseTrafficPlanFromPublicNote extracts quota bytes, billing direction, and active [from, to)
// cycle window for `now`. Works even when publicNote is empty (defaults to natural month, unlimited).
func ParseTrafficPlanFromPublicNote(publicNote string, now time.Time) (maxBytes uint64, trafficType string, cycleFrom, cycleTo time.Time) {
	loc := now.Location()
	trafficType = "both"
	unit := "month"

	var anchor time.Time
	hasAnchor := false

	trimmed := strings.TrimSpace(publicNote)
	if strings.HasPrefix(trimmed, "{") {
		var parsed publicNoteTrafficMod
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			var volStr, cycStr string
			if parsed.PlanDataMod != nil {
				volStr = parsed.PlanDataMod.TrafficVol
				maxBytes = ParseTrafficVolumeBytes(volStr)
				trafficType = normalizeTrafficType(parsed.PlanDataMod.TrafficType)
			}
			if parsed.BillingDataMod != nil {
				cycStr = parsed.BillingDataMod.Cycle
				if t, ok := parseFlexibleNoteTime(parsed.BillingDataMod.StartDate, loc); ok {
					anchor = t
					hasAnchor = true
				} else if t, ok := parseFlexibleNoteTime(parsed.BillingDataMod.EndDate, loc); ok {
					anchor = t
					hasAnchor = true
				}
			}
			unit = detectTrafficCycleUnit(volStr, cycStr)
		}
	}

	if !hasAnchor {
		// Natural month starting on the 1st at 00:00:00
		anchor = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	}

	switch unit {
	case "day":
		startOfToday := time.Date(now.Year(), now.Month(), now.Day(), anchor.Hour(), anchor.Minute(), anchor.Second(), 0, loc)
		if now.Before(startOfToday) {
			cycleFrom = startOfToday.AddDate(0, 0, -1)
		} else {
			cycleFrom = startOfToday
		}
		cycleTo = cycleFrom.AddDate(0, 0, 1)
	case "week":
		step := 7 * 24 * time.Hour
		diff := now.Sub(anchor)
		k := math.Floor(float64(diff) / float64(step))
		cycleFrom = anchor.Add(time.Duration(k) * step)
		if now.Before(cycleFrom) {
			cycleFrom = cycleFrom.Add(-step)
		}
		for !now.Before(cycleFrom.Add(step)) {
			cycleFrom = cycleFrom.Add(step)
		}
		cycleTo = cycleFrom.Add(step)
	case "year":
		cand := makeClampedMonthDate(now.Year(), anchor.Month(), anchor.Day(), anchor.Hour(), anchor.Minute(), anchor.Second(), loc)
		if now.Before(cand) {
			cycleFrom = makeClampedMonthDate(now.Year()-1, anchor.Month(), anchor.Day(), anchor.Hour(), anchor.Minute(), anchor.Second(), loc)
			cycleTo = cand
		} else {
			cycleFrom = cand
			cycleTo = makeClampedMonthDate(now.Year()+1, anchor.Month(), anchor.Day(), anchor.Hour(), anchor.Minute(), anchor.Second(), loc)
		}
	default: // "month"
		cand := makeClampedMonthDate(now.Year(), now.Month(), anchor.Day(), anchor.Hour(), anchor.Minute(), anchor.Second(), loc)
		if now.Before(cand) {
			cycleFrom = makeClampedMonthDate(now.Year(), now.Month()-1, anchor.Day(), anchor.Hour(), anchor.Minute(), anchor.Second(), loc)
			cycleTo = cand
		} else {
			cycleFrom = cand
			cycleTo = makeClampedMonthDate(now.Year(), now.Month()+1, anchor.Day(), anchor.Minute()*0+anchor.Hour(), anchor.Minute(), anchor.Second(), loc)
		}
	}
	return maxBytes, trafficType, cycleFrom, cycleTo
}

func queryCachedTransferSum(serverID uint64, from, to, now time.Time) (inBytes, outBytes uint64) {
	if DB == nil {
		return 0, 0
	}
	fromKey := from.UTC().Unix()
	toKey := to.UTC().Unix()

	autoCycleCacheMu.Lock()
	cached, ok := autoCycleCache[serverID]
	if ok && cached.fromUTC == fromKey && cached.toUTC == toKey && now.Sub(cached.fetchedAt) < autoCycleCacheTTL {
		autoCycleCacheMu.Unlock()
		return cached.inBytes, cached.outBytes
	}
	autoCycleCacheMu.Unlock()

	var row struct {
		InSum  uint64 `gorm:"column:in_sum"`
		OutSum uint64 `gorm:"column:out_sum"`
	}
	err := DB.Model(&model.Transfer{}).
		Select("COALESCE(SUM(`in`), 0) AS in_sum, COALESCE(SUM(`out`), 0) AS out_sum").
		Where("datetime(`created_at`) >= datetime(?) AND datetime(`created_at`) < datetime(?) AND datetime(`created_at`) <= datetime(?) AND server_id = ?",
			from.UTC(), to.UTC(), now.UTC(), serverID).
		Scan(&row).Error
	if err != nil {
		return 0, 0
	}

	autoCycleCacheMu.Lock()
	autoCycleCache[serverID] = cachedServerTransferSum{
		fromUTC:   fromKey,
		toUTC:     toKey,
		inBytes:   row.InSum,
		outBytes:  row.OutSum,
		fetchedAt: now,
	}
	autoCycleCacheMu.Unlock()
	return row.InSum, row.OutSum
}

func computeDirectionalBytes(trafficType string, inTotal, outTotal uint64) uint64 {
	switch trafficType {
	case "in":
		return inTotal
	case "out":
		return outTotal
	case "max":
		if inTotal >= outTotal {
			return inTotal
		}
		return outTotal
	default:
		return inTotal + outTotal
	}
}

// MergeAutoCycleTransferStats augments alert-based CycleTransferStats with automatic
// per-server cycle traffic stats derived from each server's PublicNote & hourly transfers table.
func MergeAutoCycleTransferStats(existing map[uint64]model.CycleTransferStats) map[uint64]model.CycleTransferStats {
	if Conf == nil || ServerShared == nil || DB == nil {
		return existing
	}
	snap := Conf.SettingsSnapshot()
	if snap.ThemeConfig == nil || !snap.ThemeConfig.TrafficBar.AutoRecord {
		return existing
	}

	coveredServers := make(map[uint64]struct{})
	for _, cs := range existing {
		if cs.Max == 0 {
			continue
		}
		for sid := range cs.ServerName {
			coveredServers[sid] = struct{}{}
		}
		for sid := range cs.Transfer {
			coveredServers[sid] = struct{}{}
		}
	}

	out := make(map[uint64]model.CycleTransferStats, len(existing)+32)
	for k, v := range existing {
		out[k] = v
	}

	now := time.Now()
	nextUpd := now.Add(time.Minute)

	for _, server := range ServerShared.Range {
		if server == nil {
			continue
		}
		if _, already := coveredServers[server.ID]; already {
			continue
		}

		maxBytes, tType, from, to := ParseTrafficPlanFromPublicNote(server.PublicNote, now)
		dbIn, dbOut := queryCachedTransferSum(server.ID, from, to, now)

		var liveIn, liveOut uint64
		rt := server.RuntimeSnapshot()
		if rt.State != nil {
			liveIn = utils.SubUintChecked(rt.State.NetInTransfer, rt.PrevTransferInSnapshot)
			liveOut = utils.SubUintChecked(rt.State.NetOutTransfer, rt.PrevTransferOutSnapshot)
		}

		usedBytes := computeDirectionalBytes(tType, dbIn+liveIn, dbOut+liveOut)
		synID := autoCycleIDBase + server.ID
		out[synID] = model.CycleTransferStats{
			Name:       server.Name,
			From:       from,
			To:         to,
			Max:        maxBytes,
			Min:        0,
			ServerName: map[uint64]string{server.ID: server.Name},
			Transfer:   map[uint64]uint64{server.ID: usedBytes},
			NextUpdate: map[uint64]time.Time{server.ID: nextUpd},
		}
	}

	return out
}
