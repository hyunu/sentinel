package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAnthropicProviderConvertsMessagesAndParsesToolUse(t *testing.T) {
	var got map[string]any
	var apiKey, version string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		apiKey = r.Header.Get("x-api-key")
		version = r.Header.Get("anthropic-version")
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"content": [
				{"type": "text", "text": "확인했습니다."},
				{"type": "tool_use", "id": "toolu_1", "name": "stats", "input": {"field": "temperature_celsius"}}
			],
			"stop_reason": "tool_use",
			"usage": {"input_tokens": 12, "output_tokens": 3}
		}`)
	}))
	defer srv.Close()

	cfg := ProviderConfig{
		Provider: "anthropic",
		BaseURL:  srv.URL,
		APIKey:   "anthropic-key",
		Model:    "claude-test",
		Timeout:  5 * time.Second,
	}
	provider, err := NewProvider(cfg)
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}

	temp := 0.1
	resp, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []Message{
			{Role: RoleSystem, Content: "You are Sentinel."},
			{Role: RoleUser, Content: "온도 알려줘"},
			{Role: RoleAssistant, Content: "조회하겠습니다.", ToolCalls: []ToolCall{
				{ID: "toolu_1", Name: "stats", Arguments: json.RawMessage(`{"field":"temperature_celsius"}`)},
				{ID: "toolu_2", Name: "stats", Arguments: json.RawMessage(`{"field":"humidity_percent"}`)},
			}},
			{Role: RoleTool, ToolCallID: "toolu_1", Content: `{"avg":21.5}`},
			{Role: RoleTool, ToolCallID: "toolu_2", Content: `{"avg":40}`},
		},
		Tools:       []ToolSpec{{Name: "stats", Description: "field stats", Parameters: json.RawMessage(`{"type":"object"}`)}},
		MaxTokens:   512,
		Temperature: &temp,
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	if apiKey != "anthropic-key" {
		t.Fatalf("x-api-key = %q", apiKey)
	}
	if version != anthropicVersion {
		t.Fatalf("anthropic-version = %q", version)
	}
	if got["system"] != "You are Sentinel." {
		t.Fatalf("system = %#v", got["system"])
	}
	if got["max_tokens"] != float64(512) {
		t.Fatalf("max_tokens = %#v", got["max_tokens"])
	}

	tools, ok := got["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("tools = %#v", got["tools"])
	}
	tool := tools[0].(map[string]any)
	if tool["name"] != "stats" {
		t.Fatalf("tool name = %#v", tool["name"])
	}
	if _, ok := tool["input_schema"]; !ok {
		t.Fatalf("missing input_schema: %#v", tool)
	}

	messages, ok := got["messages"].([]any)
	if !ok || len(messages) != 3 {
		t.Fatalf("messages = %#v", messages)
	}
	if messages[0].(map[string]any)["role"] != "user" {
		t.Fatalf("first message role = %#v", messages[0])
	}
	assistant := messages[1].(map[string]any)
	if assistant["role"] != "assistant" {
		t.Fatalf("second message role = %#v", assistant)
	}
	assistantBlocks := assistant["content"].([]any)
	if len(assistantBlocks) != 3 {
		t.Fatalf("assistant blocks = %#v", assistantBlocks)
	}
	if assistantBlocks[1].(map[string]any)["type"] != "tool_use" {
		t.Fatalf("assistant tool block = %#v", assistantBlocks[1])
	}
	last := messages[2].(map[string]any)
	if last["role"] != "user" {
		t.Fatalf("tool result role = %#v", last)
	}
	lastBlocks := last["content"].([]any)
	if len(lastBlocks) != 2 {
		t.Fatalf("tool results should be merged into one user message: %#v", lastBlocks)
	}
	if lastBlocks[0].(map[string]any)["type"] != "tool_result" {
		t.Fatalf("tool result block = %#v", lastBlocks[0])
	}

	if len(resp.ToolCalls) != 1 || resp.ToolCalls[0].Name != "stats" {
		t.Fatalf("tool calls = %#v", resp.ToolCalls)
	}
	if string(resp.ToolCalls[0].Arguments) != `{"field":"temperature_celsius"}` {
		t.Fatalf("arguments = %s", resp.ToolCalls[0].Arguments)
	}
	if resp.Content != "확인했습니다." {
		t.Fatalf("content = %q", resp.Content)
	}
	if resp.Usage == nil || resp.Usage.PromptTokens != 12 || resp.Usage.CompletionTokens != 3 {
		t.Fatalf("usage = %#v", resp.Usage)
	}
}

func TestAnthropicProviderRequiresAPIKey(t *testing.T) {
	_, err := NewProvider(ProviderConfig{Provider: "anthropic", Model: "claude-test"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestAnthropicProviderUsesDefaultEndpoint(t *testing.T) {
	if got := anthropicMessagesURL(""); got != "https://api.anthropic.com/v1/messages" {
		t.Fatalf("url = %q", got)
	}
	if got := anthropicMessagesURL("https://proxy.example.com/"); got != "https://proxy.example.com/v1/messages" {
		t.Fatalf("url = %q", got)
	}
}
