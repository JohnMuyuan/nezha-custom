package model

// ServiceInfos 服务监控信息（兼容旧API）
type ServiceInfos struct {
	ServiceID    uint64    `json:"monitor_id"`
	ServerID     uint64    `json:"server_id"`
	ServiceName  string    `json:"monitor_name"`
	ServerName   string    `json:"server_name"`
	DisplayIndex int       `json:"display_index"` // 展示排序，越大越靠前
	CreatedAt    []int64   `json:"created_at"`
	AvgDelay     []float64 `json:"avg_delay"`
}

// DataPoint 数据点
type DataPoint struct {
	Timestamp int64   `json:"ts"`
	Delay     float64 `json:"delay"`
	Status    uint8   `json:"status"` // 1=成功, 0=失败
}

// ServiceHistorySummary 服务历史统计摘要
type ServiceHistorySummary struct {
	AvgDelay   float64     `json:"avg_delay"`
	UpPercent  float32     `json:"up_percent"`
	TotalUp    uint64      `json:"total_up"`
	TotalDown  uint64      `json:"total_down"`
	DataPoints []DataPoint `json:"data_points,omitempty"`
}

// ServerServiceStats 某服务器对某服务的统计
type ServerServiceStats struct {
	ServerID   uint64                `json:"server_id"`
	ServerName string                `json:"server_name,omitempty"`
	Stats      ServiceHistorySummary `json:"stats"`
}

// ServiceHistoryResponse 服务历史查询响应
type ServiceHistoryResponse struct {
	ServiceID   uint64               `json:"service_id"`
	ServiceName string               `json:"service_name,omitempty"`
	Servers     []ServerServiceStats `json:"servers"`
}

// ServerMetricsDataPoint 服务器指标数据点
type ServerMetricsDataPoint struct {
	Timestamp int64   `json:"ts"`
	Value     float64 `json:"value"`
}

// ServerMetricsResponse 服务器指标历史查询响应
type ServerMetricsResponse struct {
	ServerID   uint64                   `json:"server_id"`
	ServerName string                   `json:"server_name,omitempty"`
	Metric     string                   `json:"metric"`
	DataPoints []ServerMetricsDataPoint `json:"data_points"`
}

// LatencySparkPoint 对齐分桶后的微型趋势点（同时服务矩阵迷你曲线与多机对比折线图）
type LatencySparkPoint struct {
	Timestamp int64    `json:"ts"`
	Delay     *float64 `json:"delay"`
	Loss      float64  `json:"loss"`
}

// LatencyCellStats 单个服务器对单个探测目标的延迟与稳定性聚合指标
type LatencyCellStats struct {
	LatestMs       *float64            `json:"latest_ms"`
	AvgMs          *float64            `json:"avg_ms"`
	MinMs          *float64            `json:"min_ms"`
	MaxMs          *float64            `json:"max_ms"`
	P95Ms          *float64            `json:"p95_ms"`
	JitterMs       *float64            `json:"jitter_ms"`
	StdDevMs       *float64            `json:"std_dev_ms"`
	LossPercent    float64             `json:"loss_percent"`
	SampleCount    int                 `json:"sample_count"`
	StabilityScore float64             `json:"stability_score"`
	Sparkline      []LatencySparkPoint `json:"sparkline,omitempty"`
}

// LatencyOverviewMonitor 延迟矩阵中的探测目标列
type LatencyOverviewMonitor struct {
	ID           uint64 `json:"id"`
	Name         string `json:"name"`
	DisplayIndex int    `json:"display_index"`
}

// LatencyOverviewServer 延迟矩阵中的服务器行及综合统计
type LatencyOverviewServer struct {
	ID             uint64                       `json:"id"`
	Name           string                       `json:"name"`
	CountryCode    string                       `json:"country_code"`
	DisplayIndex   int                          `json:"display_index"`
	Online         bool                         `json:"online"`
	AvgMs          *float64                     `json:"avg_ms"`
	LatestMs       *float64                     `json:"latest_ms"`
	P95Ms          *float64                     `json:"p95_ms"`
	JitterMs       *float64                     `json:"jitter_ms"`
	LossPercent    float64                      `json:"loss_percent"`
	StabilityScore *float64                     `json:"stability_score"`
	MonitorCount   int                          `json:"monitor_count"`
	Cells          map[uint64]*LatencyCellStats `json:"cells"`
}

// LatencyOverviewResponse 全服务器延迟与稳定性总览响应
type LatencyOverviewResponse struct {
	Period      string                   `json:"period"`
	GeneratedAt int64                    `json:"generated_at"`
	BucketMs    int64                    `json:"bucket_ms"`
	Monitors    []LatencyOverviewMonitor `json:"monitors"`
	Servers     []LatencyOverviewServer  `json:"servers"`
}
