package singleton

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type publicNoteBillingMod struct {
	StartDate   string `json:"startDate"`
	EndDate     string `json:"endDate"`
	AutoRenewal string `json:"autoRenewal"`
	Cycle       string `json:"cycle"`
	Amount      string `json:"amount"`
}

type publicNoteEnvelope struct {
	BillingDataMod *publicNoteBillingMod `json:"billingDataMod"`
}

type ExpiryAlertEntry struct {
	ServerID      uint64
	ServerName    string
	RemainDays    int
	ExpiryDateStr string
	Amount        string
	Cycle         string
	AutoRenewal   bool
}

var (
	expiryNotifyMu   sync.Mutex
	expiryNotifiedOn = make(map[string]string) // "serverID:day" -> "YYYY-MM-DD"
)

// ParseBillingExpiryDays parses Nezha public_note billingDataMod and returns
// remaining days until expiry (matching frontend getDaysBetweenDatesWithAutoRenewal).
func ParseBillingExpiryDays(publicNote string, now time.Time) (remainDays int, expiryDate time.Time, amount string, cycle string, autoRenewal bool, ok bool) {
	trimmed := strings.TrimSpace(publicNote)
	if trimmed == "" || !strings.HasPrefix(trimmed, "{") {
		return 0, time.Time{}, "", "", false, false
	}
	var env publicNoteEnvelope
	if err := json.Unmarshal([]byte(trimmed), &env); err != nil || env.BillingDataMod == nil {
		return 0, time.Time{}, "", "", false, false
	}
	b := env.BillingDataMod
	endRaw := strings.TrimSpace(b.EndDate)
	if endRaw == "" || strings.HasPrefix(endRaw, "0000-00-00") {
		return 0, time.Time{}, "", "", false, false
	}
	cycleRaw := strings.TrimSpace(b.Cycle)
	if cycleRaw == "-" || strings.Contains(strings.ToLower(cycleRaw), "一次性") || strings.Contains(strings.ToLower(cycleRaw), "one") {
		return 0, time.Time{}, "", "", false, false
	}

	loc := now.Location()
	endTime, parsed := parseFlexibleDate(endRaw, loc)
	if !parsed {
		return 0, time.Time{}, "", "", false, false
	}

	autoRen := strings.TrimSpace(b.AutoRenewal) == "1"
	if autoRen && !endTime.After(now) {
		endTime = advanceBillingCycle(endTime, cycleRaw, now)
	}

	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	endDayStart := time.Date(endTime.Year(), endTime.Month(), endTime.Day(), 0, 0, 0, 0, loc)
	days := int(math.Ceil(endDayStart.Sub(todayStart).Hours() / 24.0))
	return days, endDayStart, strings.TrimSpace(b.Amount), cycleRaw, autoRen, true
}

func parseFlexibleDate(raw string, loc *time.Location) (time.Time, bool) {
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05-07:00",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
		"2006/01/02",
	}
	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, raw, loc); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func advanceBillingCycle(base time.Time, cycleRaw string, now time.Time) time.Time {
	lower := strings.ToLower(cycleRaw)
	months := 1
	switch {
	case strings.Contains(lower, "年") || strings.Contains(lower, "year") || strings.Contains(lower, "yr") || strings.Contains(lower, "annual"):
		months = 12
	case strings.Contains(lower, "半年") || strings.Contains(lower, "half") || strings.Contains(lower, "semi"):
		months = 6
	case strings.Contains(lower, "季") || strings.Contains(lower, "quarter"):
		months = 3
	default:
		months = 1
	}
	cur := base
	for i := 0; i < 240 && !cur.After(now); i++ {
		cur = cur.AddDate(0, months, 0)
	}
	return cur
}

func parseAlertDayThresholds(raw string) []int {
	var days []int
	seen := make(map[int]struct{})
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		v, err := strconv.Atoi(part)
		if err != nil || v < 0 || v > 365 {
			continue
		}
		if _, ok := seen[v]; !ok {
			seen[v] = struct{}{}
			days = append(days, v)
		}
	}
	if len(days) == 0 {
		return []int{7, 3, 1}
	}
	sort.Ints(days)
	return days
}

// CollectExpiringServers scans ServerShared for servers whose remaining days
// match the configured thresholds (or if includeWithinMax is true, any <= maxThreshold).
func CollectExpiringServers(alertDaysRaw string, now time.Time, includeWithinMax bool) []ExpiryAlertEntry {
	if ServerShared == nil {
		return nil
	}
	thresholds := parseAlertDayThresholds(alertDaysRaw)
	thresholdSet := make(map[int]struct{}, len(thresholds))
	maxThreshold := 0
	for _, d := range thresholds {
		thresholdSet[d] = struct{}{}
		if d > maxThreshold {
			maxThreshold = d
		}
	}

	var entries []ExpiryAlertEntry
	for _, server := range ServerShared.Range {
		if server == nil {
			continue
		}
		days, expDate, amount, cycle, autoRen, ok := ParseBillingExpiryDays(server.PublicNote, now)
		if !ok {
			continue
		}
		matched := false
		if includeWithinMax {
			matched = days <= maxThreshold
		} else {
			_, matched = thresholdSet[days]
			if days == 0 {
				matched = true
			}
		}
		if !matched {
			continue
		}
		entries = append(entries, ExpiryAlertEntry{
			ServerID:      server.ID,
			ServerName:    server.Name,
			RemainDays:    days,
			ExpiryDateStr: expDate.Format("2006-01-02"),
			Amount:        amount,
			Cycle:         cycle,
			AutoRenewal:   autoRen,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].RemainDays != entries[j].RemainDays {
			return entries[i].RemainDays < entries[j].RemainDays
		}
		return entries[i].ServerID < entries[j].ServerID
	})
	return entries
}

// CheckAndSendExpiryNotifications runs hourly from cron. When force is true
// (admin manual test button), it ignores hour/dedup guards and sends immediately.
func CheckAndSendExpiryNotifications(force bool) (sentCount int, message string, err error) {
	if Conf == nil || NotificationShared == nil {
		return 0, "", fmt.Errorf("notification service unavailable")
	}
	snap := Conf.SettingsSnapshot()
	if snap.ThemeConfig == nil {
		return 0, "", nil
	}
	cfg := snap.ThemeConfig.ExpiryNotify
	if !force && !cfg.Enabled {
		return 0, "", nil
	}
	if cfg.NotificationGroupID == 0 {
		if force {
			return 0, "", fmt.Errorf("请先在主题增强设置中选择一个通知组并保存")
		}
		return 0, "", nil
	}

	loc := Loc
	if loc == nil {
		loc = time.Local
	}
	now := time.Now().In(loc)
	if !force && now.Hour() != cfg.CheckHour {
		return 0, "", nil
	}

	entries := CollectExpiringServers(cfg.AlertDays, now, force)
	todayKey := now.Format("2006-01-02")

	var toSend []ExpiryAlertEntry
	if force {
		toSend = entries
	} else {
		expiryNotifyMu.Lock()
		// Prune old date markers to keep memory bounded
		for k, v := range expiryNotifiedOn {
			if v != todayKey {
				delete(expiryNotifiedOn, k)
			}
		}
		for _, item := range entries {
			dedupKey := fmt.Sprintf("%d:%d", item.ServerID, item.RemainDays)
			if expiryNotifiedOn[dedupKey] == todayKey {
				continue
			}
			expiryNotifiedOn[dedupKey] = todayKey
			toSend = append(toSend, item)
		}
		expiryNotifyMu.Unlock()
	}

	if len(toSend) == 0 {
		if force {
			testMsg := fmt.Sprintf("[%s] 资产续费提醒测试\n当前无处于阈值（%s 天）内的临期服务器，通知通道正常！",
				snap.SiteName, cfg.AlertDays)
			NotificationShared.SendNotification(cfg.NotificationGroupID, testMsg, "")
			return 0, testMsg, nil
		}
		return 0, "", nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("[%s] 资产续费到期提醒（共 %d 台）\n", snap.SiteName, len(toSend)))
	for _, item := range toSend {
		statusText := fmt.Sprintf("剩余 %d 天", item.RemainDays)
		if item.RemainDays == 0 {
			statusText = "今天到期"
		} else if item.RemainDays < 0 {
			statusText = fmt.Sprintf("已过期 %d 天", -item.RemainDays)
		}
		priceInfo := ""
		if item.Amount != "" {
			priceInfo = " | " + item.Amount
			if item.Cycle != "" {
				priceInfo += "/" + item.Cycle
			}
		}
		autoTag := ""
		if item.AutoRenewal {
			autoTag = " [自动续费]"
		}
		sb.WriteString(fmt.Sprintf("• %s：%s（%s%s）%s\n", item.ServerName, statusText, item.ExpiryDateStr, priceInfo, autoTag))
	}

	msg := strings.TrimSpace(sb.String())
	NotificationShared.SendNotification(cfg.NotificationGroupID, msg, "")
	log.Printf("NEZHA>> Sent expiry notification for %d server(s) to group %d", len(toSend), cfg.NotificationGroupID)
	return len(toSend), msg, nil
}
