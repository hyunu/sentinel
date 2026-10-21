package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultAnthropicBaseURL = "https://api.anthropic.com"
	anthropicVersion        = "2023-06-01"
)

type anthropicProvider struct {
	baseURL string
	apiKey  string
	model   string
	client  *http.Client
}

func newAnthropicProvider(cfg ProviderConfig) (*anthropicProvider, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("anthropic api key is required")
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	return &anthropicProvider{
		baseURL: cfg.BaseURL,
		apiKey:  cfg.APIKey,
		model:   cfg.Model,
		client:  &http.Client{Timeout: timeout},
	}, nil
}

func (p *anthropicProvider) Name() string  { return ProviderAnthropic }
func (p *anthropicProvider) Model() string { return p.model }

func anthropicMessagesURL(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		base = defaultAnthropicBaseURL
	}
	if strings.HasSuffix(base, "/v1/messages") {
		return base
	}
	if strings.HasSuffix(base, "/v1") {
		return base + "/messages"
	}
	if parsed, err := url.Parse(base); err == nil && (parsed.Path == "" || parsed.Path == "/") {
		base += "/v1"
	}
	return base + "/messages"
}

type anthropicRequest struct {
	Model       string             `json:"model"`
	System      string             `json:"system,omitempty"`
	Messages    []anthropicMessage `json:"messages"`
	Tools       []anthropicTool    `json:"tools,omitempty"`
	MaxTokens   int                `json:"max_tokens"`
	Temperature *float64           `json:"temperature,omitempty"`
}

type anthropicMessage struct {
	Role    string           `json:"role"`
	Content []anthropicBlock `json:"content"`
}

type anthropicBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
	ToolUseID string          `json:"tool_use_id,omitempty"`
	Content   string          `json:"content,omitempty"`
	IsError   bool            `json:"is_error,omitempty"`
}

type anthropicTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type anthropicResponse struct {
	Content []struct {
		Type  string          `json:"type"`
		Text  string          `json:"text"`
		ID    string          `json:"id"`
		Name  string          `json:"name"`
		Input json.RawMessage `json:"input"`
	} `json:"content"`
	StopReason string `json:"stop_reason"`
	Usage      struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

func (p *anthropicProvider) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	system, messages := toAnthropicMessages(req.Messages)
	body := anthropicRequest{
		Model:       p.model,
		System:      system,
		Messages:    messages,
		MaxTokens:   req.MaxTokens,
		Temperature: req.Temperature,
	}
	if body.MaxTokens <= 0 {
		body.MaxTokens = 1024
	}
	for _, tool := range req.Tools {
		schema := tool.Parameters
		if len(schema) == 0 {
			schema = json.RawMessage(`{"type":"object","properties":{}}`)
		}
		body.Tools = append(body.Tools, anthropicTool{
			Name:        tool.Name,
			Description: tool.Description,
			InputSchema: schema,
		})
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("encode ai request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicMessagesURL(p.baseURL), bytes.NewReader(payload))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("create ai request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", p.apiKey)
	httpReq.Header.Set("anthropic-version", anthropicVersion)
	httpReq.Header.Set("User-Agent", "sentinel-ai/1.0")

	res, err := p.client.Do(httpReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("ai request failed: %w", err)
	}
	defer res.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("read ai response: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ChatResponse{}, fmt.Errorf("ai provider returned status %d: %s", res.StatusCode, strings.TrimSpace(truncateText(string(respBody), maxProviderErrorBody)))
	}

	var decoded anthropicResponse
	if err := json.Unmarshal(respBody, &decoded); err != nil {
		return ChatResponse{}, fmt.Errorf("decode ai response: %w", err)
	}

	result := ChatResponse{FinishReason: decoded.StopReason}
	var textParts []string
	for i, block := range decoded.Content {
		switch block.Type {
		case "text":
			if strings.TrimSpace(block.Text) != "" {
				textParts = append(textParts, strings.TrimSpace(block.Text))
			}
		case "tool_use":
			id := block.ID
			if id == "" {
				id = fmt.Sprintf("call_%d", i+1)
			}
			result.ToolCalls = append(result.ToolCalls, ToolCall{
				ID:        id,
				Name:      block.Name,
				Arguments: normalizeArgumentsBytes(block.Input),
			})
		}
	}
	result.Content = strings.Join(textParts, "\n")
	if decoded.Usage.InputTokens > 0 || decoded.Usage.OutputTokens > 0 {
		result.Usage = &Usage{
			PromptTokens:     decoded.Usage.InputTokens,
			CompletionTokens: decoded.Usage.OutputTokens,
			TotalTokens:      decoded.Usage.InputTokens + decoded.Usage.OutputTokens,
		}
	}
	return result, nil
}

func toAnthropicMessages(messages []Message) (string, []anthropicMessage) {
	var systemParts []string
	out := make([]anthropicMessage, 0, len(messages))

	appendMessage := func(role string, blocks ...anthropicBlock) {
		if len(blocks) == 0 {
			return
		}
		if len(out) > 0 && out[len(out)-1].Role == role {
			out[len(out)-1].Content = append(out[len(out)-1].Content, blocks...)
			return
		}
		out = append(out, anthropicMessage{Role: role, Content: blocks})
	}

	for _, msg := range messages {
		switch msg.Role {
		case RoleSystem:
			if strings.TrimSpace(msg.Content) != "" {
				systemParts = append(systemParts, strings.TrimSpace(msg.Content))
			}
		case RoleUser:
			appendMessage("user", anthropicBlock{Type: "text", Text: msg.Content})
		case RoleAssistant:
			if strings.TrimSpace(msg.Content) != "" {
				appendMessage("assistant", anthropicBlock{Type: "text", Text: msg.Content})
			}
			for _, call := range msg.ToolCalls {
				input := normalizeArgumentsBytes(call.Arguments)
				appendMessage("assistant", anthropicBlock{
					Type:  "tool_use",
					ID:    call.ID,
					Name:  call.Name,
					Input: input,
				})
			}
		case RoleTool:
			appendMessage("user", anthropicBlock{
				Type:      "tool_result",
				ToolUseID: msg.ToolCallID,
				Content:   msg.Content,
			})
		}
	}

	return strings.Join(systemParts, "\n\n"), out
}
