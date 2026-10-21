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

const maxProviderErrorBody = 2048

type openAIProvider struct {
	baseURL string
	apiKey  string
	model   string
	client  *http.Client
}

func newOpenAIProvider(cfg ProviderConfig) (*openAIProvider, error) {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	return &openAIProvider{
		baseURL: cfg.BaseURL,
		apiKey:  cfg.APIKey,
		model:   cfg.Model,
		client:  &http.Client{Timeout: timeout},
	}, nil
}

func (p *openAIProvider) Name() string  { return ProviderOpenAI }
func (p *openAIProvider) Model() string { return p.model }

func chatCompletionsURL(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		base = defaultOpenAIBaseURL
	}
	if strings.HasSuffix(base, "/chat/completions") {
		return base
	}
	if parsed, err := url.Parse(base); err == nil && (parsed.Path == "" || parsed.Path == "/") {
		base += "/v1"
	}
	return base + "/chat/completions"
}

type openAIChatRequest struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	Tools       []openAITool    `json:"tools,omitempty"`
	ToolChoice  string          `json:"tool_choice,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Temperature *float64        `json:"temperature,omitempty"`
}

type openAIMessage struct {
	Role       string           `json:"role"`
	Content    string           `json:"content,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
	Name       string           `json:"name,omitempty"`
}

type openAITool struct {
	Type     string             `json:"type"`
	Function openAIToolFunction `json:"function"`
}

type openAIToolFunction struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type openAIToolCall struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Function openAIToolCallFunc `json:"function"`
}

type openAIToolCallFunc struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type openAIChatResponse struct {
	Choices []struct {
		Message struct {
			Content   string           `json:"content"`
			ToolCalls []openAIToolCall `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func (p *openAIProvider) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	body := openAIChatRequest{
		Model:       p.model,
		Messages:    toOpenAIMessages(req.Messages),
		MaxTokens:   req.MaxTokens,
		Temperature: req.Temperature,
	}
	if len(req.Tools) > 0 {
		body.Tools = make([]openAITool, 0, len(req.Tools))
		for _, tool := range req.Tools {
			params := tool.Parameters
			if len(params) == 0 {
				params = json.RawMessage(`{"type":"object","properties":{}}`)
			}
			body.Tools = append(body.Tools, openAITool{
				Type: "function",
				Function: openAIToolFunction{
					Name:        tool.Name,
					Description: tool.Description,
					Parameters:  params,
				},
			})
		}
		body.ToolChoice = "auto"
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("encode ai request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, chatCompletionsURL(p.baseURL), bytes.NewReader(payload))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("create ai request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if p.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	}
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

	var decoded openAIChatResponse
	if err := json.Unmarshal(respBody, &decoded); err != nil {
		return ChatResponse{}, fmt.Errorf("decode ai response: %w", err)
	}
	if len(decoded.Choices) == 0 {
		return ChatResponse{}, fmt.Errorf("ai provider returned no choices")
	}

	choice := decoded.Choices[0]
	result := ChatResponse{
		Content:      strings.TrimSpace(choice.Message.Content),
		FinishReason: choice.FinishReason,
	}
	for i, call := range choice.Message.ToolCalls {
		id := call.ID
		if id == "" {
			id = fmt.Sprintf("call_%d", i+1)
		}
		result.ToolCalls = append(result.ToolCalls, ToolCall{
			ID:        id,
			Name:      call.Function.Name,
			Arguments: normalizeArguments(call.Function.Arguments),
		})
	}
	if decoded.Usage != nil {
		result.Usage = &Usage{
			PromptTokens:     decoded.Usage.PromptTokens,
			CompletionTokens: decoded.Usage.CompletionTokens,
			TotalTokens:      decoded.Usage.TotalTokens,
		}
	}
	return result, nil
}

func toOpenAIMessages(messages []Message) []openAIMessage {
	out := make([]openAIMessage, 0, len(messages))
	for _, msg := range messages {
		converted := openAIMessage{
			Role:       string(msg.Role),
			Content:    msg.Content,
			ToolCallID: msg.ToolCallID,
			Name:       msg.Name,
		}
		for _, call := range msg.ToolCalls {
			converted.ToolCalls = append(converted.ToolCalls, openAIToolCall{
				ID:   call.ID,
				Type: "function",
				Function: openAIToolCallFunc{
					Name:      call.Name,
					Arguments: string(normalizeArgumentsBytes(call.Arguments)),
				},
			})
		}
		out = append(out, converted)
	}
	return out
}

func normalizeArguments(raw string) json.RawMessage {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return json.RawMessage(`{}`)
	}
	if compact := compactJSON([]byte(raw)); compact != nil {
		return compact
	}
	quoted, _ := json.Marshal(raw)
	return quoted
}

func normalizeArgumentsBytes(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	if compact := compactJSON(raw); compact != nil {
		return compact
	}
	quoted, _ := json.Marshal(string(raw))
	return quoted
}

func compactJSON(raw []byte) json.RawMessage {
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return nil
	}
	return json.RawMessage(buf.Bytes())
}

func truncateText(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
