package model

import "time"

// ServerInspection persists the latest lightweight inspection reports
// (media unlock, three-network backhaul route, and IP quality / SMTP 25)
// for each monitored server. One compact row per server (~2-3 KB).
type ServerInspection struct {
	ServerID        uint64    `gorm:"primaryKey;autoIncrement:false" json:"server_id"`
	MediaJSON       string    `gorm:"type:text" json:"-"`
	BackhaulJSON    string    `gorm:"type:text" json:"-"`
	IPQualityJSON   string    `gorm:"type:text" json:"-"`
	LastMediaAt     time.Time `json:"last_media_at,omitempty"`
	LastBackhaulAt  time.Time `json:"last_backhaul_at,omitempty"`
	LastIPQualityAt time.Time `json:"last_ip_quality_at,omitempty"`
	LastError       string    `gorm:"type:text" json:"last_error,omitempty"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// MediaCheckStatus values:
// "yes" (unlocked), "full" (Netflix full), "originals" (Netflix originals only),
// "web" (ChatGPT web only), "cn" (YouTube/Google routed to CN),
// "no" (blocked/not available), "na" (network/IPv6 unavailable), "error" (timeout/parse failed).
type MediaCheckItem struct {
	Platform string `json:"platform"`
	Name     string `json:"name"`
	Category string `json:"category"` // streaming | ai
	Status   string `json:"status"`
	Region   string `json:"region,omitempty"`
	Note     string `json:"note,omitempty"`
}

type MediaUnlockReport struct {
	IPv4Available bool             `json:"ipv4_available"`
	IPv6Available bool             `json:"ipv6_available"`
	IPv4          []MediaCheckItem `json:"ipv4"`
	IPv6          []MediaCheckItem `json:"ipv6,omitempty"`
	CheckedAt     time.Time        `json:"checked_at"`
}

type BackhaulRouteItem struct {
	ISP        string   `json:"isp"`        // ct | cu | cm
	ISPLabel   string   `json:"isp_label"`  // 电信 | 联通 | 移动
	Target     string   `json:"target"`
	RouteType  string   `json:"route_type"` // CN2 GIA | CN2 GT | 163 | AS9929 | AS4837 | CMIN2 | CMI | 普通直连 / 未知
	Tier       string   `json:"tier"`       // premium | good | standard | unknown
	Hops       []string `json:"hops,omitempty"`
	LatencyMs  float64  `json:"latency_ms,omitempty"`
}

type BackhaulReport struct {
	Tool      string              `json:"tool,omitempty"`
	Routes    []BackhaulRouteItem `json:"routes"`
	CheckedAt time.Time           `json:"checked_at"`
}

type IPQualityReport struct {
	IP            string    `json:"ip,omitempty"`
	ASN           string    `json:"asn,omitempty"`
	Org           string    `json:"org,omitempty"`
	ISP           string    `json:"isp,omitempty"`
	Country       string    `json:"country,omitempty"`
	Region        string    `json:"region,omitempty"`
	City          string    `json:"city,omitempty"`
	IPType        string    `json:"ip_type,omitempty"`      // residential | datacenter | mobile | unknown
	RiskLevel     string    `json:"risk_level,omitempty"`   // low | medium | high | unknown
	IsDatacenter  bool      `json:"is_datacenter"`
	IsProxy       bool      `json:"is_proxy"`
	IsVPN         bool      `json:"is_vpn"`
	IsTor         bool      `json:"is_tor"`
	IsAbuser      bool      `json:"is_abuser"`
	GoogleRegion  string    `json:"google_region,omitempty"`
	GoogleCN      bool      `json:"google_cn"`
	SMTP25Open    *bool     `json:"smtp_25_open,omitempty"`
	DNSBLClean    *bool     `json:"dnsbl_clean,omitempty"`
	DNSBLListed   []string  `json:"dnsbl_listed,omitempty"`
	CheckedAt     time.Time `json:"checked_at"`
}

type ServerInspectionPayload struct {
	ServerID   uint64             `json:"server_id"`
	Running    bool               `json:"running"`
	Media      *MediaUnlockReport `json:"media,omitempty"`
	Backhaul   *BackhaulReport    `json:"backhaul,omitempty"`
	IPQuality  *IPQualityReport   `json:"ip_quality,omitempty"`
	LastError  string             `json:"last_error,omitempty"`
	UpdatedAt  time.Time          `json:"updated_at,omitempty"`
}

// InspectionSummary is the lightweight map value returned by GET /api/v1/server/inspections
// for homepage multi-dimensional filtering (Netflix/Disney+/ChatGPT/Claude/Gemini/route).
type InspectionSummary struct {
	ServerID     uint64            `json:"server_id"`
	Running      bool              `json:"running"`
	Unlocked     map[string]string `json:"unlocked,omitempty"` // platform -> status ("full"|"yes"|"originals"|"web"|"cn"|"no")
	Regions      map[string]string `json:"regions,omitempty"`  // platform -> region code
	Routes       map[string]string `json:"routes,omitempty"`   // ct|cu|cm -> route_type
	IPType       string            `json:"ip_type,omitempty"`
	GoogleCN     bool              `json:"google_cn,omitempty"`
	SMTP25Open   *bool             `json:"smtp_25_open,omitempty"`
	UpdatedAt    time.Time         `json:"updated_at,omitempty"`
}
