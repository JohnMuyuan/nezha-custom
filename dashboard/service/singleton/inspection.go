package singleton

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"gorm.io/gorm/clause"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
)

var InspectionShared *InspectionClass

const (
	inspectionTaskIDMask uint64 = 1 << 60
	inspectionCmdTimeout        = 75 * time.Second
)

type pendingInspectionTask struct {
	serverID uint64
	ch       chan *pb.TaskResult
}

type InspectionClass struct {
	mu          sync.RWMutex
	cache       map[uint64]*model.ServerInspectionPayload
	running     map[uint64]bool
	pendingMu   sync.Mutex
	pending     map[uint64]*pendingInspectionTask
	taskSeq     atomic.Uint64
	sem         chan struct{}
	semCap      int
	semMu       sync.Mutex
}

func NewInspectionClass() *InspectionClass {
	ic := &InspectionClass{
		cache:   make(map[uint64]*model.ServerInspectionPayload),
		running: make(map[uint64]bool),
		pending: make(map[uint64]*pendingInspectionTask),
		sem:     make(chan struct{}, 2),
		semCap:  2,
	}
	ic.taskSeq.Store(uint64(time.Now().UnixNano() & 0x0fffffff))
	ic.loadFromDB()
	return ic
}

func (ic *InspectionClass) loadFromDB() {
	if DB == nil {
		return
	}
	var rows []model.ServerInspection
	if err := DB.Find(&rows).Error; err != nil {
		log.Printf("NEZHA>> Failed to load server_inspections: %v", err)
		return
	}
	ic.mu.Lock()
	defer ic.mu.Unlock()
	for _, row := range rows {
		ic.cache[row.ServerID] = decodeInspectionRow(&row)
	}
}

func decodeInspectionRow(row *model.ServerInspection) *model.ServerInspectionPayload {
	p := &model.ServerInspectionPayload{
		ServerID:  row.ServerID,
		LastError: row.LastError,
		UpdatedAt: row.UpdatedAt,
	}
	if row.MediaJSON != "" {
		var m model.MediaUnlockReport
		if err := json.Unmarshal([]byte(row.MediaJSON), &m); err == nil {
			p.Media = &m
		}
	}
	if row.BackhaulJSON != "" {
		var b model.BackhaulReport
		if err := json.Unmarshal([]byte(row.BackhaulJSON), &b); err == nil {
			p.Backhaul = &b
		}
	}
	if row.IPQualityJSON != "" {
		var q model.IPQualityReport
		if err := json.Unmarshal([]byte(row.IPQualityJSON), &q); err == nil {
			p.IPQuality = &q
		}
	}
	return p
}

func (ic *InspectionClass) Get(serverID uint64) *model.ServerInspectionPayload {
	ic.mu.RLock()
	defer ic.mu.RUnlock()
	existing := ic.cache[serverID]
	running := ic.running[serverID]
	if existing == nil {
		return &model.ServerInspectionPayload{
			ServerID: serverID,
			Running:  running,
		}
	}
	copied := *existing
	copied.Running = running
	return &copied
}

func (ic *InspectionClass) ListSummaries(allowedIDs map[uint64]struct{}) map[uint64]*model.InspectionSummary {
	ic.mu.RLock()
	defer ic.mu.RUnlock()

	out := make(map[uint64]*model.InspectionSummary, len(ic.cache))
	for sid, payload := range ic.cache {
		if allowedIDs != nil {
			if _, ok := allowedIDs[sid]; !ok {
				continue
			}
		}
		s := &model.InspectionSummary{
			ServerID:  sid,
			Running:   ic.running[sid],
			UpdatedAt: payload.UpdatedAt,
		}
		if payload.Media != nil {
			s.Unlocked = make(map[string]string, len(payload.Media.IPv4))
			s.Regions = make(map[string]string, len(payload.Media.IPv4))
			for _, item := range payload.Media.IPv4 {
				s.Unlocked[item.Platform] = item.Status
				if item.Region != "" {
					s.Regions[item.Platform] = item.Region
				}
			}
			// If IPv4 was blocked/na but IPv6 unlocked, surface the better status
			for _, item := range payload.Media.IPv6 {
				cur := s.Unlocked[item.Platform]
				if !isMediaUnlockedStatus(cur) && isMediaUnlockedStatus(item.Status) {
					s.Unlocked[item.Platform] = item.Status
					if item.Region != "" {
						s.Regions[item.Platform] = item.Region
					}
				}
			}
		}
		if payload.Backhaul != nil && len(payload.Backhaul.Routes) > 0 {
			s.Routes = make(map[string]string, len(payload.Backhaul.Routes))
			for _, r := range payload.Backhaul.Routes {
				s.Routes[r.ISP] = r.RouteType
			}
		}
		if payload.IPQuality != nil {
			s.IPType = payload.IPQuality.IPType
			s.GoogleCN = payload.IPQuality.GoogleCN
			s.SMTP25Open = payload.IPQuality.SMTP25Open
		}
		out[sid] = s
	}
	for sid, isRun := range ic.running {
		if !isRun {
			continue
		}
		if allowedIDs != nil {
			if _, ok := allowedIDs[sid]; !ok {
				continue
			}
		}
		if _, exists := out[sid]; !exists {
			out[sid] = &model.InspectionSummary{ServerID: sid, Running: true}
		}
	}
	return out
}

func isMediaUnlockedStatus(status string) bool {
	return status == "full" || status == "yes" || status == "originals" || status == "web"
}

// HandleCommandResult intercepts TaskTypeCommand results belonging to inspection tasks.
// Returns true if the task ID belonged to an in-flight inspection task.
func (ic *InspectionClass) HandleCommandResult(clientID uint64, result *pb.TaskResult) bool {
	if result == nil {
		return false
	}
	taskID := result.GetId()
	if taskID&inspectionTaskIDMask == 0 {
		return false
	}
	ic.pendingMu.Lock()
	entry, ok := ic.pending[taskID]
	if ok && entry.serverID != clientID {
		// Reject cross-server result spoofing
		ic.pendingMu.Unlock()
		log.Printf("NEZHA>> Inspection result rejected: clientID=%d spoofed taskID=%d owned by server %d", clientID, taskID, entry.serverID)
		return true
	}
	if ok {
		delete(ic.pending, taskID)
	}
	ic.pendingMu.Unlock()

	if ok {
		select {
		case entry.ch <- result:
		default:
		}
	}
	return true
}

func (ic *InspectionClass) acquireSemaphore(ctx context.Context) (func(), error) {
	ic.semMu.Lock()
	wantCap := 2
	if Conf != nil && Conf.ThemeConfig != nil && Conf.ThemeConfig.MediaUnlock.MaxConcurrency > 0 {
		wantCap = Conf.ThemeConfig.MediaUnlock.MaxConcurrency
	}
	if wantCap < 1 {
		wantCap = 1
	} else if wantCap > 5 {
		wantCap = 5
	}
	if ic.sem == nil || ic.semCap != wantCap {
		ic.sem = make(chan struct{}, wantCap)
		ic.semCap = wantCap
	}
	sem := ic.sem
	ic.semMu.Unlock()

	select {
	case sem <- struct{}{}:
		return func() { <-sem }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (ic *InspectionClass) dispatchCommand(ctx context.Context, server *model.Server, script string) (string, error) {
	if server == nil || server.GetTaskStream() == nil {
		return "", errors.New("server agent is offline")
	}
	taskID := inspectionTaskIDMask | (ic.taskSeq.Add(1) & ((uint64(1) << 59) - 1))
	ch := make(chan *pb.TaskResult, 1)

	ic.pendingMu.Lock()
	ic.pending[taskID] = &pendingInspectionTask{
		serverID: server.ID,
		ch:       ch,
	}
	ic.pendingMu.Unlock()

	defer func() {
		ic.pendingMu.Lock()
		delete(ic.pending, taskID)
		ic.pendingMu.Unlock()
	}()

	if err := server.SendTask(&pb.Task{
		Id:   taskID,
		Type: model.TaskTypeCommand,
		Data: script,
	}); err != nil {
		return "", fmt.Errorf("failed to dispatch inspection command: %w", err)
	}

	select {
	case res := <-ch:
		if res == nil {
			return "", errors.New("empty command result")
		}
		if !res.GetSuccessful() && strings.TrimSpace(res.GetData()) == "" {
			return "", errors.New("agent command execution failed (check disable_command_execute)")
		}
		return res.GetData(), nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// TriggerServer starts an asynchronous inspection for one server.
// Scopes may contain "media", "backhaul", "ip_quality". Empty scopes runs all enabled scopes.
func (ic *InspectionClass) TriggerServer(serverID uint64, scopes []string) error {
	if ServerShared == nil {
		return errors.New("server registry unavailable")
	}
	server, ok := ServerShared.Get(serverID)
	if !ok || server == nil {
		return errors.New("server not found")
	}
	if server.GetTaskStream() == nil {
		return errors.New("server agent is offline")
	}

	ic.mu.Lock()
	if ic.running[serverID] {
		ic.mu.Unlock()
		return nil // Already running; idempotent
	}
	ic.running[serverID] = true
	ic.mu.Unlock()

	go ic.executeInspection(serverID, scopes)
	return nil
}

// TriggerAllOnline queues staggered inspections for all currently connected servers.
func (ic *InspectionClass) TriggerAllOnline(scopes []string) int {
	if ServerShared == nil {
		return 0
	}
	count := 0
	for _, server := range ServerShared.Range {
		if server == nil || server.GetTaskStream() == nil {
			continue
		}
		if err := ic.TriggerServer(server.ID, scopes); err == nil {
			count++
		}
	}
	return count
}

// shouldScheduleInspection decides whether a server's inspection is due.
// A 15-minute grace window prevents hourly cron ticks from drifting +1h/day
// when a 24h cycle finishes a few minutes after the trigger minute.
func shouldScheduleInspection(updatedAt, now time.Time, intervalHours int) bool {
	if intervalHours <= 0 {
		return false
	}
	if updatedAt.IsZero() {
		return true
	}
	grace := time.Duration(0)
	if intervalHours >= 2 {
		grace = 15 * time.Minute
	}
	cutoff := now.Add(-time.Duration(intervalHours)*time.Hour + grace)
	return updatedAt.Before(cutoff)
}

// RunScheduledChecks runs periodically (hourly cron + startup warm-up) and
// triggers inspections for online servers whose last check is older than auto_interval_hours.
func (ic *InspectionClass) RunScheduledChecks() {
	if ic == nil || Conf == nil {
		return
	}
	snap := Conf.SettingsSnapshot()
	if snap.ThemeConfig == nil || !snap.ThemeConfig.MediaUnlock.Enabled {
		return
	}
	intervalHours := snap.ThemeConfig.MediaUnlock.AutoIntervalHours
	if intervalHours <= 0 {
		return
	}
	if ServerShared == nil {
		return
	}
	now := time.Now()
	queued := 0
	for _, server := range ServerShared.Range {
		if server == nil || server.GetTaskStream() == nil {
			continue
		}
		cur := ic.Get(server.ID)
		if cur.Running {
			continue
		}
		if shouldScheduleInspection(cur.UpdatedAt, now, intervalHours) {
			if err := ic.TriggerServer(server.ID, nil); err == nil {
				queued++
			}
		}
	}
	if queued > 0 {
		log.Printf("NEZHA>> Scheduled automatic inspection for %d online server(s) (interval=%dh)", queued, intervalHours)
	}
}

func (ic *InspectionClass) executeInspection(serverID uint64, reqScopes []string) {
	defer func() {
		ic.mu.Lock()
		delete(ic.running, serverID)
		ic.mu.Unlock()
	}()

	queueCtx, queueCancel := context.WithTimeout(context.Background(), 20*time.Minute)
	release, err := ic.acquireSemaphore(queueCtx)
	queueCancel()
	if err != nil {
		return
	}
	defer release()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	server, ok := ServerShared.Get(serverID)
	if !ok || server == nil || server.GetTaskStream() == nil {
		return
	}

	var cfg model.ThemeMediaUnlockConfig
	if Conf != nil {
		snap := Conf.SettingsSnapshot()
		if snap.ThemeConfig != nil {
			cfg = snap.ThemeConfig.MediaUnlock
		}
	}
	if len(cfg.Platforms) == 0 {
		cfg.Platforms = model.DefaultMediaUnlockPlatforms
	}

	wantMedia := len(reqScopes) == 0 || slices.Contains(reqScopes, "media")
	wantBackhaul := (len(reqScopes) == 0 && cfg.CheckBackhaul) || slices.Contains(reqScopes, "backhaul")
	wantIPQuality := (len(reqScopes) == 0 && cfg.CheckIPQuality) || slices.Contains(reqScopes, "ip_quality")

	// Start from existing cached payload so partial scope runs keep other reports intact
	payload := ic.Get(serverID)
	payload.Running = true
	var errs []string
	now := time.Now()

	if wantMedia {
		cmdCtx, cmdCancel := context.WithTimeout(ctx, inspectionCmdTimeout)
		out, cmdErr := ic.dispatchCommand(cmdCtx, server, BuildMediaUnlockScript(cfg.CheckIPv6, cfg.Platforms))
		cmdCancel()
		if cmdErr != nil {
			errs = append(errs, "media: "+cmdErr.Error())
		} else {
			report := ParseMediaUnlockOutput(out, cfg.Platforms, now)
			payload.Media = report
		}
	}

	if wantBackhaul {
		cmdCtx, cmdCancel := context.WithTimeout(ctx, inspectionCmdTimeout)
		out, cmdErr := ic.dispatchCommand(cmdCtx, server, BuildBackhaulScript())
		cmdCancel()
		if cmdErr != nil {
			errs = append(errs, "backhaul: "+cmdErr.Error())
		} else {
			payload.Backhaul = ParseBackhaulOutput(out, now)
		}
	}

	if wantIPQuality {
		cmdCtx, cmdCancel := context.WithTimeout(ctx, inspectionCmdTimeout)
		out, cmdErr := ic.dispatchCommand(cmdCtx, server, BuildIPQualityScript())
		cmdCancel()
		if cmdErr != nil {
			errs = append(errs, "ip_quality: "+cmdErr.Error())
		} else {
			payload.IPQuality = ParseIPQualityOutput(out, now)
		}
	}

	payload.LastError = strings.Join(errs, "; ")
	payload.UpdatedAt = time.Now()
	payload.Running = false

	ic.savePayload(payload)
}

func (ic *InspectionClass) savePayload(payload *model.ServerInspectionPayload) {
	ic.mu.Lock()
	copied := *payload
	ic.cache[payload.ServerID] = &copied
	ic.mu.Unlock()

	if DB == nil {
		return
	}
	row := model.ServerInspection{
		ServerID:  payload.ServerID,
		LastError: payload.LastError,
		UpdatedAt: payload.UpdatedAt,
	}
	if payload.Media != nil {
		if b, err := json.Marshal(payload.Media); err == nil {
			row.MediaJSON = string(b)
		}
		row.LastMediaAt = payload.Media.CheckedAt
	}
	if payload.Backhaul != nil {
		if b, err := json.Marshal(payload.Backhaul); err == nil {
			row.BackhaulJSON = string(b)
		}
		row.LastBackhaulAt = payload.Backhaul.CheckedAt
	}
	if payload.IPQuality != nil {
		if b, err := json.Marshal(payload.IPQuality); err == nil {
			row.IPQualityJSON = string(b)
		}
		row.LastIPQualityAt = payload.IPQuality.CheckedAt
	}

	if err := DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "server_id"}},
		UpdateAll: true,
	}).Create(&row).Error; err != nil {
		log.Printf("NEZHA>> Failed to persist server_inspection for server %d: %v", payload.ServerID, err)
	}
}

// ============================================================================
// Pure POSIX /bin/sh Probe Scripts (Zero external script downloads)
// ============================================================================

var mediaPlatformMeta = map[string]struct {
	Name     string
	Category string
}{
	"netflix":  {Name: "Netflix", Category: "streaming"},
	"disney":   {Name: "Disney+", Category: "streaming"},
	"youtube":  {Name: "YouTube Premium", Category: "streaming"},
	"tiktok":   {Name: "TikTok", Category: "streaming"},
	"spotify":  {Name: "Spotify", Category: "streaming"},
	"prime":    {Name: "Prime Video", Category: "streaming"},
	"hbo":      {Name: "Max (HBO)", Category: "streaming"},
	"bilibili": {Name: "Bilibili", Category: "streaming"},
	"chatgpt":  {Name: "ChatGPT", Category: "ai"},
	"claude":   {Name: "Claude", Category: "ai"},
	"gemini":   {Name: "Google Gemini", Category: "ai"},
}

func BuildMediaUnlockScript(checkIPv6 bool, platforms []string) string {
	enabled := make(map[string]bool, len(platforms))
	for _, p := range platforms {
		enabled[strings.ToLower(strings.TrimSpace(p))] = true
	}
	var b strings.Builder
	b.WriteString(`set +e
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
if ! command -v curl >/dev/null 2>&1; then echo "ERR|no_curl"; exit 0; fi

run_stack() {
  IPVER="$1"
  FLAG="-4"
  [ "$IPVER" = "v6" ] && FLAG="-6"
  if ! curl $FLAG -fsS --connect-timeout 3 --max-time 4 "https://www.cloudflare.com/cdn-cgi/trace" >/dev/null 2>&1; then
    echo "STACK|$IPVER|0"
    return
  fi
  echo "STACK|$IPVER|1"
`)

	if enabled["netflix"] {
		b.WriteString(`
  # Netflix: non-original (81280792) + original (80018499)
  NF1=$(curl $FLAG -sS -o /dev/null -w "%{http_code}" -A "$UA" --connect-timeout 4 --max-time 6 "https://www.netflix.com/title/81280792" 2>/dev/null)
  NF2=$(curl $FLAG -sS -o /dev/null -w "%{http_code}" -A "$UA" --connect-timeout 4 --max-time 6 "https://www.netflix.com/title/80018499" 2>/dev/null)
  if [ "$NF1" = "200" ]; then
    NFREG=$(curl $FLAG -sSI -A "$UA" --connect-timeout 4 --max-time 6 "https://www.netflix.com/title/81280792" 2>/dev/null | grep -i "^x-originating-url:" | sed -n 's/.*netflix\.com\/\([a-zA-Z]\{2\}\)[-\/].*/\1/p' | head -n 1 | tr 'a-z' 'A-Z')
    [ -z "$NFREG" ] && NFREG="US"
    echo "MEDIA|$IPVER|netflix|full|$NFREG"
  elif [ "$NF2" = "200" ]; then
    echo "MEDIA|$IPVER|netflix|originals|"
  elif [ "$NF1" = "403" ] || [ "$NF1" = "404" ] || [ "$NF2" = "403" ]; then
    echo "MEDIA|$IPVER|netflix|no|"
  else
    echo "MEDIA|$IPVER|netflix|error|"
  fi
`)
	}
	if enabled["disney"] {
		b.WriteString(`
  # Disney+
  DP=$(curl $FLAG -sSL -A "$UA" --connect-timeout 4 --max-time 6 "https://www.disneyplus.com/" 2>/dev/null)
  if echo "$DP" | grep -qi "unavailable\|sorry, disney+ is not available"; then
    echo "MEDIA|$IPVER|disney|no|"
  elif echo "$DP" | grep -qi "disney"; then
    DPREG=$(echo "$DP" | grep -oE '"countryCode":"[A-Z]{2}"' | head -n 1 | cut -d'"' -f4)
    echo "MEDIA|$IPVER|disney|yes|$DPREG"
  else
    echo "MEDIA|$IPVER|disney|no|"
  fi
`)
	}
	if enabled["youtube"] {
		b.WriteString(`
  # YouTube Premium + CN check
  YT=$(curl $FLAG -sSL -A "$UA" -H "Accept-Language: en" --connect-timeout 4 --max-time 6 "https://www.youtube.com/premium" 2>/dev/null)
  YTREG=$(echo "$YT" | grep -oE '"INNERTUBE_CONTEXT_GL":"[A-Z]{2}"' | head -n 1 | cut -d'"' -f4)
  if [ "$YTREG" = "CN" ]; then
    echo "MEDIA|$IPVER|youtube|cn|CN"
  elif echo "$YT" | grep -qi "YouTube Premium is not available in your country"; then
    echo "MEDIA|$IPVER|youtube|no|$YTREG"
  elif [ -n "$YTREG" ]; then
    echo "MEDIA|$IPVER|youtube|yes|$YTREG"
  else
    echo "MEDIA|$IPVER|youtube|error|"
  fi
`)
	}
	if enabled["tiktok"] {
		b.WriteString(`
  # TikTok
  TT=$(curl $FLAG -sSL -A "$UA" --connect-timeout 4 --max-time 6 "https://www.tiktok.com/" 2>/dev/null)
  TTREG=$(echo "$TT" | grep -oE '"region":"[A-Z]{2}"' | head -n 1 | cut -d'"' -f4)
  if [ -n "$TTREG" ]; then
    echo "MEDIA|$IPVER|tiktok|yes|$TTREG"
  else
    echo "MEDIA|$IPVER|tiktok|no|"
  fi
`)
	}
	if enabled["spotify"] {
		b.WriteString(`
  # Spotify
  SP=$(curl $FLAG -sSI -A "$UA" --connect-timeout 4 --max-time 6 "https://www.spotify.com/" 2>/dev/null | grep -i "^location:" | head -n 1)
  SPREG=$(echo "$SP" | sed -n 's/.*spotify\.com\/\([a-zA-Z]\{2\}\)[-\/].*/\1/p' | tr 'a-z' 'A-Z')
  if [ -n "$SPREG" ]; then
    echo "MEDIA|$IPVER|spotify|yes|$SPREG"
  else
    SPCODE=$(curl $FLAG -sS -o /dev/null -w "%{http_code}" -A "$UA" --connect-timeout 4 --max-time 6 "https://open.spotify.com/" 2>/dev/null)
    if [ "$SPCODE" = "200" ] || [ "$SPCODE" = "302" ]; then
      echo "MEDIA|$IPVER|spotify|yes|"
    else
      echo "MEDIA|$IPVER|spotify|no|"
    fi
  fi
`)
	}
	if enabled["prime"] {
		b.WriteString(`
  # Prime Video
  PV=$(curl $FLAG -sSL -A "$UA" --connect-timeout 4 --max-time 6 "https://www.primevideo.com/" 2>/dev/null)
  PVREG=$(echo "$PV" | grep -oE '"currentTerritory":"[A-Z]{2}"' | head -n 1 | cut -d'"' -f4)
  if [ -n "$PVREG" ]; then
    echo "MEDIA|$IPVER|prime|yes|$PVREG"
  else
    echo "MEDIA|$IPVER|prime|no|"
  fi
`)
	}
	if enabled["hbo"] {
		b.WriteString(`
  # Max (HBO)
  HBO=$(curl $FLAG -sSL -A "$UA" --connect-timeout 4 --max-time 6 "https://www.max.com/" 2>/dev/null)
  if echo "$HBO" | grep -qi "not available in your region\|geo-availability"; then
    echo "MEDIA|$IPVER|hbo|no|"
  elif echo "$HBO" | grep -qi "max\.com"; then
    HBOREG=$(echo "$HBO" | grep -oE '"countryCode":"[A-Z]{2}"' | head -n 1 | cut -d'"' -f4)
    echo "MEDIA|$IPVER|hbo|yes|$HBOREG"
  else
    echo "MEDIA|$IPVER|hbo|no|"
  fi
`)
	}
	if enabled["bilibili"] {
		b.WriteString(`
  # Bilibili (HK/MO/TW vs CN)
  BL_TW=$(curl $FLAG -sS -A "$UA" --connect-timeout 4 --max-time 6 "https://api.bilibili.com/pgc/player/web/playurl?avid=50762638&cid=100279344&qn=0&type=&otype=json&ep_id=268176&fourk=1" 2>/dev/null)
  BL_HK=$(curl $FLAG -sS -A "$UA" --connect-timeout 4 --max-time 6 "https://api.bilibili.com/pgc/player/web/playurl?avid=18281381&cid=29892777&qn=0&type=&otype=json&ep_id=183799&fourk=1" 2>/dev/null)
  if echo "$BL_HK" | grep -q '"code":0'; then
    echo "MEDIA|$IPVER|bilibili|yes|HK/TW"
  elif echo "$BL_TW" | grep -q '"code":0'; then
    echo "MEDIA|$IPVER|bilibili|yes|TW"
  else
    BL_CN=$(curl $FLAG -sS -A "$UA" --connect-timeout 4 --max-time 6 "https://api.bilibili.com/pgc/player/web/playurl?avid=82846771&cid=141802636&qn=0&type=&otype=json&ep_id=307247&fourk=1" 2>/dev/null)
    if echo "$BL_CN" | grep -q '"code":0'; then
      echo "MEDIA|$IPVER|bilibili|yes|CN"
    else
      echo "MEDIA|$IPVER|bilibili|no|"
    fi
  fi
`)
	}
	if enabled["chatgpt"] {
		b.WriteString(`
  # ChatGPT / OpenAI
  CG_TRACE=$(curl $FLAG -sS --connect-timeout 4 --max-time 6 "https://chatgpt.com/cdn-cgi/trace" 2>/dev/null)
  CG_LOC=$(echo "$CG_TRACE" | grep "^loc=" | cut -d= -f2)
  CG_IOS=$(curl $FLAG -sS -o /dev/null -w "%{http_code}" -A "$UA" --connect-timeout 4 --max-time 6 "https://ios.chat.openai.com/public-api/mobile/server_status/v1" 2>/dev/null)
  CG_WEB=$(curl $FLAG -sS -o /dev/null -w "%{http_code}" -A "$UA" --connect-timeout 4 --max-time 6 "https://chatgpt.com/" 2>/dev/null)
  case "$CG_LOC" in
    CN|HK|MO|RU|BY|KP|IR|SY|CU)
      echo "MEDIA|$IPVER|chatgpt|no|$CG_LOC"
      ;;
    *)
      if { [ "$CG_IOS" = "200" ] || [ "$CG_IOS" = "403" ]; } && [ "$CG_WEB" != "451" ] && [ -n "$CG_LOC" ]; then
        if [ "$CG_IOS" = "200" ]; then
          echo "MEDIA|$IPVER|chatgpt|yes|$CG_LOC"
        else
          echo "MEDIA|$IPVER|chatgpt|web|$CG_LOC"
        fi
      else
        echo "MEDIA|$IPVER|chatgpt|no|$CG_LOC"
      fi
      ;;
  esac
`)
	}
	if enabled["claude"] {
		b.WriteString(`
  # Claude
  CL_TRACE=$(curl $FLAG -sS --connect-timeout 4 --max-time 6 "https://claude.ai/cdn-cgi/trace" 2>/dev/null)
  CL_LOC=$(echo "$CL_TRACE" | grep "^loc=" | cut -d= -f2)
  case "$CL_LOC" in
    CN|HK|MO|RU|BY|KP|IR|SY|CU|"")
      echo "MEDIA|$IPVER|claude|no|$CL_LOC"
      ;;
    *)
      CL_CODE=$(curl $FLAG -sS -o /dev/null -w "%{http_code}" -A "$UA" --connect-timeout 4 --max-time 6 "https://claude.ai/login" 2>/dev/null)
      if [ "$CL_CODE" = "200" ] || [ "$CL_CODE" = "302" ] || [ "$CL_CODE" = "403" ]; then
        echo "MEDIA|$IPVER|claude|yes|$CL_LOC"
      else
        echo "MEDIA|$IPVER|claude|no|$CL_LOC"
      fi
      ;;
  esac
`)
	}
	if enabled["gemini"] {
		b.WriteString(`
  # Google Gemini
  GM=$(curl $FLAG -sSL -A "$UA" --connect-timeout 4 --max-time 6 "https://gemini.google.com/" 2>/dev/null)
  if echo "$GM" | grep -qi "45631641,null,true"; then
    GMREG=$(echo "$GM" | grep -oE ',2,1,200,"[A-Z]{3}"' | head -n 1 | cut -d'"' -f2)
    echo "MEDIA|$IPVER|gemini|yes|$GMREG"
  else
    GM_LOC=$(curl $FLAG -sS --connect-timeout 4 --max-time 6 "https://www.cloudflare.com/cdn-cgi/trace" 2>/dev/null | grep "^loc=" | cut -d= -f2)
    case "$GM_LOC" in
      CN|HK|MO|RU|BY|KP|IR|SY|"")
        echo "MEDIA|$IPVER|gemini|no|$GM_LOC"
        ;;
      *)
        if echo "$GM" | grep -qi "gemini"; then
          echo "MEDIA|$IPVER|gemini|yes|$GM_LOC"
        else
          echo "MEDIA|$IPVER|gemini|no|$GM_LOC"
        fi
        ;;
    esac
  fi
`)
	}

	b.WriteString(`}
run_stack v4
`)
	if checkIPv6 {
		b.WriteString(`run_stack v6
`)
	}
	return b.String()
}

func ParseMediaUnlockOutput(raw string, platforms []string, checkedAt time.Time) *model.MediaUnlockReport {
	report := &model.MediaUnlockReport{
		CheckedAt: checkedAt,
		IPv4:      []model.MediaCheckItem{},
		IPv6:      []model.MediaCheckItem{},
	}
	v4Map := make(map[string]model.MediaCheckItem)
	v6Map := make(map[string]model.MediaCheckItem)

	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) >= 3 && parts[0] == "STACK" {
			if parts[1] == "v4" && parts[2] == "1" {
				report.IPv4Available = true
			}
			if parts[1] == "v6" && parts[2] == "1" {
				report.IPv6Available = true
			}
			continue
		}
		if len(parts) >= 4 && parts[0] == "MEDIA" {
			stack := parts[1]
			plat := strings.ToLower(strings.TrimSpace(parts[2]))
			status := strings.ToLower(strings.TrimSpace(parts[3]))
			region := ""
			if len(parts) >= 5 {
				region = strings.TrimSpace(parts[4])
			}
			meta, ok := mediaPlatformMeta[plat]
			if !ok {
				continue
			}
			item := model.MediaCheckItem{
				Platform: plat,
				Name:     meta.Name,
				Category: meta.Category,
				Status:   status,
				Region:   region,
			}
			if stack == "v6" {
				v6Map[plat] = item
			} else {
				v4Map[plat] = item
			}
		}
	}

	for _, p := range platforms {
		plat := strings.ToLower(strings.TrimSpace(p))
		meta, ok := mediaPlatformMeta[plat]
		if !ok {
			continue
		}
		if item, found := v4Map[plat]; found {
			report.IPv4 = append(report.IPv4, item)
		} else if report.IPv4Available {
			report.IPv4 = append(report.IPv4, model.MediaCheckItem{
				Platform: plat, Name: meta.Name, Category: meta.Category, Status: "error",
			})
		}
		if report.IPv6Available {
			if item, found := v6Map[plat]; found {
				report.IPv6 = append(report.IPv6, item)
			}
		}
	}
	return report
}

// ============================================================================
// Three-Network Backhaul Route Script & Classifier
// ============================================================================

func BuildBackhaulScript() string {
	return `set +e
TOOL=""
if command -v mtr >/dev/null 2>&1; then
  TOOL="mtr"
elif command -v traceroute >/dev/null 2>&1; then
  TOOL="traceroute"
elif command -v tracepath >/dev/null 2>&1; then
  TOOL="tracepath"
fi
echo "TOOL|$TOOL"
if [ -z "$TOOL" ]; then exit 0; fi

trace_target() {
  ISP="$1"
  TARGET="$2"
  OUT=""
  TO=""
  command -v timeout >/dev/null 2>&1 && TO="timeout 12"
  if [ "$TOOL" = "mtr" ]; then
    OUT=$($TO mtr -4 -rn -c 1 -m 18 "$TARGET" 2>/dev/null)
  elif [ "$TOOL" = "traceroute" ]; then
    OUT=$($TO traceroute -4 -n -q 1 -w 1 -m 18 "$TARGET" 2>/dev/null)
  else
    OUT=$($TO tracepath -4 -n -m 18 "$TARGET" 2>/dev/null)
  fi
  IPS=$(echo "$OUT" | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | awk '!seen[$0]++' | tr '\n' ',')
  echo "ROUTE|$ISP|$TARGET|$IPS"
}

trace_target ct 202.96.209.133
trace_target cu 210.22.97.1
trace_target cm 211.136.112.200
`
}

var ipv4HopRegex = regexp.MustCompile(`^(\d{1,3}\.){3}\d{1,3}$`)

func classifyBackhaulRoute(isp string, hops []string) (routeType string, tier string) {
	has5943 := false
	has20297 := false
	has9929 := false
	has4837 := false
	hasCMI := false
	hasCMIN2 := false

	for _, ip := range hops {
		switch {
		case strings.HasPrefix(ip, "59.43."):
			has5943 = true
		case strings.HasPrefix(ip, "202.97."):
			has20297 = true
		case strings.HasPrefix(ip, "218.105.") || strings.HasPrefix(ip, "210.78."):
			has9929 = true
		case strings.HasPrefix(ip, "219.158.") || strings.HasPrefix(ip, "210.51."):
			has4837 = true
		case strings.HasPrefix(ip, "58.87.") || strings.HasPrefix(ip, "223.120.19.") || strings.HasPrefix(ip, "223.120.22."):
			hasCMIN2 = true
		case strings.HasPrefix(ip, "223.120.") || strings.HasPrefix(ip, "221.183.") || strings.HasPrefix(ip, "221.176."):
			hasCMI = true
		}
	}

	switch isp {
	case "ct":
		if has5943 && !has20297 {
			return "CN2 GIA", "premium"
		}
		if has5943 && has20297 {
			return "CN2 GT", "good"
		}
		if has9929 {
			return "联通 AS9929", "premium"
		}
		if has20297 {
			return "电信 163", "standard"
		}
	case "cu":
		if has9929 {
			return "联通 AS9929", "premium"
		}
		if has5943 {
			return "电信 CN2", "premium"
		}
		if has4837 {
			return "联通 4837", "good"
		}
		if has20297 {
			return "绕道 163", "standard"
		}
	case "cm":
		if hasCMIN2 {
			return "移动 CMIN2", "premium"
		}
		if has5943 {
			return "电信 CN2", "premium"
		}
		if has9929 {
			return "联通 AS9929", "premium"
		}
		if hasCMI {
			return "移动 CMI", "good"
		}
		if has20297 {
			return "绕道 163", "standard"
		}
	}

	if len(hops) > 0 {
		return "普通直连", "standard"
	}
	return "未检测到", "unknown"
}

func ParseBackhaulOutput(raw string, checkedAt time.Time) *model.BackhaulReport {
	report := &model.BackhaulReport{
		CheckedAt: checkedAt,
		Routes:    []model.BackhaulRouteItem{},
	}
	labels := map[string]string{"ct": "电信", "cu": "联通", "cm": "移动"}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		parts := strings.Split(line, "|")
		if len(parts) >= 2 && parts[0] == "TOOL" {
			report.Tool = parts[1]
			continue
		}
		if len(parts) >= 4 && parts[0] == "ROUTE" {
			isp := parts[1]
			target := parts[2]
			var hops []string
			for _, h := range strings.Split(parts[3], ",") {
				h = strings.TrimSpace(h)
				if ipv4HopRegex.MatchString(h) && h != target {
					hops = append(hops, h)
				}
			}
			rType, tier := classifyBackhaulRoute(isp, hops)
			report.Routes = append(report.Routes, model.BackhaulRouteItem{
				ISP:       isp,
				ISPLabel:  labels[isp],
				Target:    target,
				RouteType: rType,
				Tier:      tier,
				Hops:      hops,
			})
		}
	}
	return report
}

// ============================================================================
// IP Quality, Google Region, SMTP 25 & DNSBL Script & Parser
// ============================================================================

func BuildIPQualityScript() string {
	return `set +e
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
if ! command -v curl >/dev/null 2>&1; then echo "ERR|no_curl"; exit 0; fi

# 1. IP metadata (primary: api.ipapi.is, fallback: ip-api.com)
IPJSON=$(curl -4 -fsS --connect-timeout 4 --max-time 6 "https://api.ipapi.is/" 2>/dev/null | tr -d '\r\n')
if [ -n "$IPJSON" ] && echo "$IPJSON" | grep -q '"ip"'; then
  echo "IPAPIIS|$IPJSON"
else
  IPFB=$(curl -4 -fsS --connect-timeout 4 --max-time 6 "http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,isp,org,as,hosting,proxy,mobile,query" 2>/dev/null | tr -d '\r\n')
  echo "IPAPICOM|$IPFB"
fi

# 2. Google region (detect CN redirect / 送中)
YT=$(curl -4 -sSL -A "$UA" -H "Accept-Language: en" --connect-timeout 4 --max-time 6 "https://www.youtube.com/premium" 2>/dev/null)
GREG=$(echo "$YT" | grep -oE '"INNERTUBE_CONTEXT_GL":"[A-Z]{2}"' | head -n 1 | cut -d'"' -f4)
echo "GOOGLE_REG|$GREG"

# 3. SMTP Port 25 outbound check
SMTP="unknown"
if command -v nc >/dev/null 2>&1; then
  if nc -z -w 3 smtp.gmail.com 25 >/dev/null 2>&1; then SMTP="open"; else SMTP="closed"; fi
elif command -v bash >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1; then
  if timeout 3 bash -c 'exec 3<>/dev/tcp/smtp.gmail.com/25' >/dev/null 2>&1; then SMTP="open"; else SMTP="closed"; fi
else
  if curl -4 -sS --connect-timeout 3 --max-time 4 "telnet://smtp.gmail.com:25" >/dev/null 2>&1; then SMTP="open"; else SMTP="closed"; fi
fi
echo "SMTP25|$SMTP"

# 4. Lightweight DNSBL check (only if getent is available)
MYIP=$(curl -4 -fsS --connect-timeout 3 --max-time 4 "https://api.ipify.org" 2>/dev/null)
echo "MYIP|$MYIP"
if [ -n "$MYIP" ] && command -v getent >/dev/null 2>&1; then
  REV=$(echo "$MYIP" | awk -F. '{print $4"."$3"."$2"."$1}')
  LISTED=""
  for BL in zen.spamhaus.org bl.spamcop.net b.barracudacentral.org; do
    RES=$(getent ahostsv4 "$REV.$BL" 2>/dev/null | awk '{print $1}' | head -n 1)
    case "$RES" in
      127.0.0.*)
        [ "$RES" != "127.255.255.254" ] && LISTED="${LISTED}${BL},"
        ;;
    esac
  done
  echo "DNSBL|checked|$LISTED"
fi
`
}

func ParseIPQualityOutput(raw string, checkedAt time.Time) *model.IPQualityReport {
	q := &model.IPQualityReport{
		IPType:    "unknown",
		RiskLevel: "unknown",
		CheckedAt: checkedAt,
	}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "IPAPIIS|") {
			body := strings.TrimPrefix(line, "IPAPIIS|")
			var d struct {
				IP           string `json:"ip"`
				IsDatacenter bool   `json:"is_datacenter"`
				IsProxy      bool   `json:"is_proxy"`
				IsVPN        bool   `json:"is_vpn"`
				IsTor        bool   `json:"is_tor"`
				IsAbuser     bool   `json:"is_abuser"`
				IsMobile     bool   `json:"is_mobile"`
				ASN          struct {
					ASN  int    `json:"asn"`
					Org  string `json:"org"`
					Type string `json:"type"`
				} `json:"asn"`
				Company struct {
					Name string `json:"name"`
					Type string `json:"type"`
				} `json:"company"`
				Location struct {
					CountryCode string `json:"country_code"`
					State       string `json:"state"`
					City        string `json:"city"`
				} `json:"location"`
			}
			if err := json.Unmarshal([]byte(body), &d); err == nil && d.IP != "" {
				q.IP = d.IP
				if d.ASN.ASN > 0 {
					q.ASN = "AS" + strconv.Itoa(d.ASN.ASN)
				}
				q.Org = d.ASN.Org
				q.ISP = d.Company.Name
				if q.ISP == "" {
					q.ISP = d.ASN.Org
				}
				q.Country = strings.ToUpper(d.Location.CountryCode)
				q.Region = d.Location.State
				q.City = d.Location.City
				q.IsDatacenter = d.IsDatacenter
				q.IsProxy = d.IsProxy
				q.IsVPN = d.IsVPN
				q.IsTor = d.IsTor
				q.IsAbuser = d.IsAbuser
				if d.IsMobile {
					q.IPType = "mobile"
				} else if d.IsDatacenter || strings.EqualFold(d.Company.Type, "hosting") || strings.EqualFold(d.ASN.Type, "hosting") {
					q.IPType = "datacenter"
				} else if strings.EqualFold(d.Company.Type, "isp") || strings.EqualFold(d.ASN.Type, "isp") {
					q.IPType = "residential"
				}
			}
		} else if strings.HasPrefix(line, "IPAPICOM|") {
			body := strings.TrimPrefix(line, "IPAPICOM|")
			var d struct {
				Status      string `json:"status"`
				CountryCode string `json:"countryCode"`
				RegionName  string `json:"regionName"`
				City        string `json:"city"`
				ISP         string `json:"isp"`
				Org         string `json:"org"`
				AS          string `json:"as"`
				Hosting     bool   `json:"hosting"`
				Proxy       bool   `json:"proxy"`
				Mobile      bool   `json:"mobile"`
				Query       string `json:"query"`
			}
			if err := json.Unmarshal([]byte(body), &d); err == nil && d.Status == "success" {
				q.IP = d.Query
				if parts := strings.Fields(d.AS); len(parts) > 0 {
					q.ASN = parts[0]
				}
				q.Org = d.Org
				q.ISP = d.ISP
				q.Country = strings.ToUpper(d.CountryCode)
				q.Region = d.RegionName
				q.City = d.City
				q.IsDatacenter = d.Hosting
				q.IsProxy = d.Proxy
				if d.Mobile {
					q.IPType = "mobile"
				} else if d.Hosting {
					q.IPType = "datacenter"
				} else {
					q.IPType = "residential"
				}
			}
		} else if strings.HasPrefix(line, "GOOGLE_REG|") {
			reg := strings.ToUpper(strings.TrimSpace(strings.TrimPrefix(line, "GOOGLE_REG|")))
			q.GoogleRegion = reg
			q.GoogleCN = reg == "CN"
		} else if strings.HasPrefix(line, "SMTP25|") {
			st := strings.TrimSpace(strings.TrimPrefix(line, "SMTP25|"))
			if st == "open" {
				v := true
				q.SMTP25Open = &v
			} else if st == "closed" {
				v := false
				q.SMTP25Open = &v
			}
		} else if strings.HasPrefix(line, "MYIP|") && q.IP == "" {
			q.IP = strings.TrimSpace(strings.TrimPrefix(line, "MYIP|"))
		} else if strings.HasPrefix(line, "DNSBL|checked|") {
			rawList := strings.TrimPrefix(line, "DNSBL|checked|")
			var listed []string
			for _, item := range strings.Split(rawList, ",") {
				item = strings.TrimSpace(item)
				if item != "" {
					listed = append(listed, item)
				}
			}
			q.DNSBLListed = listed
			clean := len(listed) == 0
			q.DNSBLClean = &clean
		}
	}

	// Derive overall risk level
	if q.IsTor || q.IsAbuser || len(q.DNSBLListed) > 0 {
		q.RiskLevel = "high"
	} else if q.IsProxy || q.IsVPN || q.GoogleCN {
		q.RiskLevel = "medium"
	} else if q.IP != "" {
		q.RiskLevel = "low"
	}
	return q
}
