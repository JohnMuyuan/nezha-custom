package singleton

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type llmFunctionDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type llmToolDef struct {
	Type     string         `json:"type"` // "function"
	Function llmFunctionDef `json:"function"`
}

type llmToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type llmChatMessage struct {
	Role             string        `json:"role"` // system | user | assistant | tool
	Content          any           `json:"content"`
	ReasoningContent string        `json:"reasoning_content,omitempty"`
	ToolCalls        []llmToolCall `json:"tool_calls,omitempty"`
	ToolCallID       string        `json:"tool_call_id,omitempty"`
}

type llmChatRequest struct {
	Model       string           `json:"model"`
	Messages    []llmChatMessage `json:"messages"`
	Tools       []llmToolDef     `json:"tools,omitempty"`
	Temperature float64          `json:"temperature,omitempty"`
	MaxTokens   int              `json:"max_tokens,omitempty"`
}

type llmChatResponse struct {
	Choices []struct {
		Message struct {
			Role             string          `json:"role"`
			Content          json.RawMessage `json:"content"`
			ReasoningContent string          `json:"reasoning_content"`
			ToolCalls        []llmToolCall   `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

var (
	thinkTagRegex         = regexp.MustCompile(`(?is)<think(?:ing)?>.*?</think(?:ing)?>`)
	unclosedThinkTagRegex = regexp.MustCompile(`(?is)<think(?:ing)?>.*$`)
)

func stripReasoningBlocks(s string) string {
	cleaned := thinkTagRegex.ReplaceAllString(s, "")
	cleaned = unclosedThinkTagRegex.ReplaceAllString(cleaned, "")
	return strings.TrimSpace(cleaned)
}

// NormalizeOpenAIChatURL converts user-supplied base URLs into a valid
// /chat/completions endpoint across OpenAI, DeepSeek, SiliconFlow, Gemini, Zhipu, DashScope, and OneAPI.
func NormalizeOpenAIChatURL(raw string) string {
	u := strings.TrimSpace(raw)
	u = strings.TrimRight(u, "/")
	if u == "" {
		return ""
	}
	lower := strings.ToLower(u)
	if strings.HasSuffix(lower, "/chat/completions") {
		return u
	}
	for _, versionSuffix := range []string{
		"/v1",
		"/v1beta/openai",
		"/compatible-mode/v1",
		"/api/v1",
		"/api/paas/v4",
		"/v4",
		"/v3",
	} {
		if strings.HasSuffix(lower, versionSuffix) {
			return u + "/chat/completions"
		}
	}
	return u + "/v1/chat/completions"
}

func extractMessageText(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return stripReasoningBlocks(s)
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &parts); err == nil {
		var sb strings.Builder
		for _, p := range parts {
			if p.Text != "" {
				sb.WriteString(p.Text)
			}
		}
		return stripReasoningBlocks(sb.String())
	}
	return ""
}

func callOpenAICompatible(
	ctx context.Context,
	baseURL string,
	apiKey string,
	modelName string,
	messages []llmChatMessage,
	tools []llmToolDef,
	maxTokens int,
) (llmChatMessage, error) {
	endpoint := NormalizeOpenAIChatURL(baseURL)
	if endpoint == "" {
		return llmChatMessage{}, errors.New("未配置模型 API 接口地址（Base URL）")
	}
	if strings.TrimSpace(apiKey) == "" {
		return llmChatMessage{}, errors.New("未配置模型 API Key")
	}
	if strings.TrimSpace(modelName) == "" {
		return llmChatMessage{}, errors.New("未填写模型名称（Model）")
	}

	reqPayload := llmChatRequest{
		Model:     strings.TrimSpace(modelName),
		Messages:  messages,
		Tools:     tools,
		MaxTokens: maxTokens,
	}
	// Reasoning models like deepseek-reasoner or o1/o3 reject non-default temperature on some providers;
	// omit temperature when model name looks like a reasoner, otherwise set 0.2 for reliable ops output.
	lowerModel := strings.ToLower(modelName)
	if !strings.Contains(lowerModel, "reasoner") && !strings.HasPrefix(lowerModel, "o1") && !strings.HasPrefix(lowerModel, "o3") && !strings.HasPrefix(lowerModel, "o4") {
		reqPayload.Temperature = 0.2
	}

	bodyBytes, err := json.Marshal(reqPayload)
	if err != nil {
		return llmChatMessage{}, err
	}

	client := &http.Client{Timeout: 240 * time.Second}
	var respBytes []byte
	var statusCode int
	var lastErr error

	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(2 * time.Second):
			case <-ctx.Done():
				return llmChatMessage{}, ctx.Err()
			}
		}
		httpReq, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
		if reqErr != nil {
			return llmChatMessage{}, fmt.Errorf("构造模型请求失败: %w", reqErr)
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
		httpReq.Header.Set("User-Agent", "Nezha-AIOps/1.1")

		resp, doErr := client.Do(httpReq)
		if doErr != nil {
			lastErr = fmt.Errorf("请求模型接口失败: %w", doErr)
			if ctx.Err() != nil {
				return llmChatMessage{}, lastErr
			}
			continue
		}
		b, readErr := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
		resp.Body.Close()
		if readErr != nil {
			lastErr = fmt.Errorf("读取模型响应失败: %w", readErr)
			continue
		}
		statusCode = resp.StatusCode
		respBytes = b
		if statusCode == 502 || statusCode == 503 || statusCode == 504 {
			lastErr = fmt.Errorf("模型网关暂时繁忙 (HTTP %d)", statusCode)
			continue
		}
		lastErr = nil
		break
	}
	if lastErr != nil && len(respBytes) == 0 {
		return llmChatMessage{}, lastErr
	}

	if statusCode < 200 || statusCode >= 300 {
		snippet := strings.TrimSpace(string(respBytes))
		if len(snippet) > 360 {
			snippet = snippet[:360] + "..."
		}
		return llmChatMessage{}, fmt.Errorf("模型接口返回 HTTP %d: %s", statusCode, snippet)
	}

	var parsed llmChatResponse
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return llmChatMessage{}, fmt.Errorf("解析模型 JSON 响应失败: %w", err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return llmChatMessage{}, fmt.Errorf("模型返回错误: %s", parsed.Error.Message)
	}
	if len(parsed.Choices) == 0 {
		return llmChatMessage{}, errors.New("模型未返回有效结果 (choices 为空)")
	}

	choice := parsed.Choices[0].Message
	textContent := extractMessageText(choice.Content)

	var contentVal any = textContent
	if textContent == "" && len(choice.ToolCalls) > 0 {
		// Some OpenAI-compatible backends expect "" or null when tool_calls are present; "" is universally accepted.
		contentVal = ""
	}

	return llmChatMessage{
		Role:             "assistant",
		Content:          contentVal,
		ReasoningContent: choice.ReasoningContent,
		ToolCalls:        choice.ToolCalls,
	}, nil
}

type smallModelTriageVerdict struct {
	Escalate bool   `json:"escalate"`
	Severity string `json:"severity"` // low | medium | high
	Summary  string `json:"summary"`
}

func parseSmallTriageVerdict(raw string) smallModelTriageVerdict {
	cleaned := stripReasoningBlocks(raw)
	// Extract JSON object if wrapped in markdown code fences or prose
	start := strings.IndexByte(cleaned, '{')
	end := strings.LastIndexByte(cleaned, '}')
	if start >= 0 && end > start {
		var v smallModelTriageVerdict
		if err := json.Unmarshal([]byte(cleaned[start:end+1]), &v); err == nil {
			if v.Severity == "" {
				if v.Escalate {
					v.Severity = "medium"
				} else {
					v.Severity = "low"
				}
			}
			if v.Summary == "" {
				v.Summary = cleaned
			}
			return v
		}
	}
	// Fallback heuristic if small model replied in plain text instead of JSON
	lower := strings.ToLower(cleaned)
	escalate := !strings.Contains(lower, `"escalate":false`) &&
		!strings.Contains(lower, `"escalate": false`) &&
		!strings.Contains(cleaned, "无需上报") &&
		!strings.Contains(cleaned, "正常波动")
	sev := "medium"
	if !escalate {
		sev = "low"
	}
	if len(cleaned) > 300 {
		cleaned = cleaned[:300] + "..."
	}
	if cleaned == "" {
		cleaned = "低级模型未返回明确摘要，默认转交高级模型复核"
	}
	return smallModelTriageVerdict{
		Escalate: escalate,
		Severity: sev,
		Summary:  cleaned,
	}
}

// TestModelConnection verifies connectivity and latency for either "small" or "large" model tier,
// supporting unsaved form inputs as well as already-saved masked secrets.
func (ao *AIOpsClass) TestModelConnection(
	ctx context.Context,
	tier string,
	overrideURL, overrideKey, overrideModel string,
	shareProvider bool,
) (replyText string, latencyMs int64, err error) {
	cfg := ao.GetConfigSnapshot()

	var baseURL, apiKey, modelName string
	if tier == "small" {
		baseURL = strings.TrimSpace(overrideURL)
		if baseURL == "" {
			baseURL = cfg.SmallBaseURL
		}
		if overrideKey != "" && overrideKey != "__CLEAR__" && !strings.Contains(overrideKey, "••••") {
			apiKey = strings.TrimSpace(overrideKey)
		} else {
			apiKey = cfg.SmallAPIKey
		}
		modelName = strings.TrimSpace(overrideModel)
		if modelName == "" {
			modelName = cfg.SmallModel
		}
	} else {
		if shareProvider {
			baseURL = strings.TrimSpace(overrideURL)
			if baseURL == "" {
				baseURL = cfg.SmallBaseURL
			}
			if overrideKey != "" && overrideKey != "__CLEAR__" && !strings.Contains(overrideKey, "••••") {
				apiKey = strings.TrimSpace(overrideKey)
			} else {
				apiKey = cfg.SmallAPIKey
			}
		} else {
			baseURL = strings.TrimSpace(overrideURL)
			if baseURL == "" {
				baseURL = cfg.LargeBaseURL
			}
			if overrideKey != "" && overrideKey != "__CLEAR__" && !strings.Contains(overrideKey, "••••") {
				apiKey = strings.TrimSpace(overrideKey)
			} else {
				apiKey = cfg.LargeAPIKey
			}
		}
		modelName = strings.TrimSpace(overrideModel)
		if modelName == "" {
			modelName = cfg.LargeModel
		}
	}

	start := time.Now()
	testCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	msg, callErr := callOpenAICompatible(
		testCtx,
		baseURL,
		apiKey,
		modelName,
		[]llmChatMessage{
			{Role: "user", Content: "请仅回复『连接成功』四个字。"},
		},
		nil,
		64,
	)
	if callErr != nil {
		return "", time.Since(start).Milliseconds(), callErr
	}
	txt, _ := msg.Content.(string)
	if strings.TrimSpace(txt) == "" {
		txt = "OK"
	}
	return txt, time.Since(start).Milliseconds(), nil
}

