package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testProviderConfig(baseURL string) ProviderConfig {
	return ProviderConfig{
		Provider: "openai",
		BaseURL:  baseURL,
		APIKey:   "test-key",
		Model:    "test-model",
		Timeout:  5 * time.Second,
	}
}

func TestOpenAIProviderChatSendsToolsAndParsesToolCalls(t *testing.T) {
	var got map[string]any
	var authHeader string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		authHeader = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"choices": [{
				"message": {
					"content": "",
					"tool_calls": [{
						"id": "call_1",
						"type": "function",
						"function": {"name": "stats", "arguments": "{\"field\":\"temperature_celsius\"}"}
					}]
				},
				"finish_reason": "tool_calls"
			}],
			"usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}
		}`)
	}))
	defer srv.Close()

	provider, err := NewProvider(testProviderConfig(srv.URL + "/v1"))
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}

	temp := 0.2
	resp, err := provider.Chat(context.Background(), ChatRequest{
		Messages:    []Message{{Role: RoleUser, Content: "최근 온도 알려줘"}},
		Tools:       []ToolSpec{{Name: "stats", Description: "field stats", Parameters: json.RawMessage(`{"type":"object"}`)}},
		MaxTokens:   256,
		Temperature: &temp,
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	if authHeader != "Bearer test-key" {
		t.Fatalf("authorization header = %q", authHeader)
	}
	if got["model"] != "test-model" {
		t.Fatalf("model = %v", got["model"])
	}
	if got["tool_choice"] != "auto" {
		t.Fatalf("tool_choice = %v", got["tool_choice"])
	}
	if got["max_tokens"] != float64(256) {
		t.Fatalf("max_tokens = %v", got["max_tokens"])
	}

	tools, ok := got["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("tools = %#v", got["tools"])
	}
	tool := tools[0].(map[string]any)
	fn := tool["function"].(map[string]any)
	if fn["name"] != "stats" {
		t.Fatalf("tool name = %v", fn["name"])
	}

	if provider.Name() != "openai" || provider.Model() != "test-model" {
		t.Fatalf("provider info = %s/%s", provider.Name(), provider.Model())
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("tool calls = %#v", resp.ToolCalls)
	}
	if resp.ToolCalls[0].Name != "stats" {
		t.Fatalf("tool call name = %q", resp.ToolCalls[0].Name)
	}
	if string(resp.ToolCalls[0].Arguments) != `{"field":"temperature_celsius"}` {
		t.Fatalf("tool call args = %s", resp.ToolCalls[0].Arguments)
	}
	if resp.Usage == nil || resp.Usage.TotalTokens != 12 {
		t.Fatalf("usage = %#v", resp.Usage)
	}
}

func TestOpenAIProviderChatWithoutToolsOmitsToolFields(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"hello"},"finish_reason":"stop"}]}`)
	}))
	defer srv.Close()

	provider, err := NewProvider(testProviderConfig(srv.URL + "/v1"))
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}
	resp, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []Message{{Role: RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Content != "hello" {
		t.Fatalf("content = %q", resp.Content)
	}
	if _, ok := got["tools"]; ok {
		t.Fatalf("tools should be omitted: %#v", got["tools"])
	}
	if _, ok := got["tool_choice"]; ok {
		t.Fatalf("tool_choice should be omitted: %#v", got["tool_choice"])
	}
}

func TestOpenAIProviderChatStreamAccumulatesContentAndToolCalls(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		chunks := []string{
			`{"choices":[{"delta":{"content":"안"},"finish_reason":null}]}`,
			`{"choices":[{"delta":{"content":"녕"}}]}`,
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"stats","arguments":"{\"field\":"}}]}}]}`,
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"temperature_celsius\"}"}}]}}]}`,
			`{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
		}
		for _, chunk := range chunks {
			_, _ = io.WriteString(w, "data: "+chunk+"\n\n")
			if flusher != nil {
				flusher.Flush()
			}
		}
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	provider, err := NewProvider(testProviderConfig(srv.URL + "/v1"))
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}
	streamer, ok := provider.(StreamingProvider)
	if !ok {
		t.Fatal("provider does not implement StreamingProvider")
	}

	var tokens []string
	resp, err := streamer.ChatStream(context.Background(), ChatRequest{
		Messages: []Message{{Role: RoleUser, Content: "온도"}},
		Tools:    []ToolSpec{{Name: "stats", Parameters: json.RawMessage(`{"type":"object"}`)}},
	}, func(token string) error {
		tokens = append(tokens, token)
		return nil
	})
	if err != nil {
		t.Fatalf("ChatStream: %v", err)
	}
	if got["stream"] != true {
		t.Fatalf("stream = %#v", got["stream"])
	}
	if strings.Join(tokens, "") != "안녕" {
		t.Fatalf("tokens = %#v", tokens)
	}
	if resp.Content != "안녕" {
		t.Fatalf("content = %q", resp.Content)
	}
	if len(resp.ToolCalls) != 1 || resp.ToolCalls[0].Name != "stats" {
		t.Fatalf("tool calls = %#v", resp.ToolCalls)
	}
	if string(resp.ToolCalls[0].Arguments) != `{"field":"temperature_celsius"}` {
		t.Fatalf("arguments = %s", resp.ToolCalls[0].Arguments)
	}
	if resp.FinishReason != "tool_calls" {
		t.Fatalf("finish reason = %q", resp.FinishReason)
	}
}

func TestOpenAIProviderReturnsReadableError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"invalid api key"}}`)
	}))
	defer srv.Close()

	provider, err := NewProvider(testProviderConfig(srv.URL + "/v1"))
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}
	_, err = provider.Chat(context.Background(), ChatRequest{
		Messages: []Message{{Role: RoleUser, Content: "hi"}},
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "401") || !strings.Contains(err.Error(), "invalid api key") {
		t.Fatalf("error = %v", err)
	}
}

func TestOpenAIProviderRequiresModel(t *testing.T) {
	cfg := testProviderConfig("http://localhost:8000/v1")
	cfg.Model = ""
	if _, err := NewProvider(cfg); err == nil {
		t.Fatal("expected error for empty model")
	}
}

func TestChatCompletionsURL(t *testing.T) {
	cases := []struct{ base, want string }{
		{"https://api.openai.com", "https://api.openai.com/v1/chat/completions"},
		{"https://api.openai.com/", "https://api.openai.com/v1/chat/completions"},
		{"https://api.openai.com/v1", "https://api.openai.com/v1/chat/completions"},
		{"https://api.openai.com/v1/", "https://api.openai.com/v1/chat/completions"},
		{"http://localhost:8000/v1", "http://localhost:8000/v1/chat/completions"},
		{"http://localhost:8000/v1/chat/completions", "http://localhost:8000/v1/chat/completions"},
	}
	for _, tc := range cases {
		if got := chatCompletionsURL(tc.base); got != tc.want {
			t.Errorf("chatCompletionsURL(%q) = %q, want %q", tc.base, got, tc.want)
		}
	}
}

func TestProviderConfigConfigured(t *testing.T) {
	cases := []struct {
		name string
		cfg  ProviderConfig
		want bool
	}{
		{"empty model", ProviderConfig{}, false},
		{"openai default without key", ProviderConfig{Provider: "openai", Model: "gpt"}, false},
		{"openai custom endpoint without key", ProviderConfig{Provider: "openai", BaseURL: "http://localhost:8000/v1", Model: "local"}, true},
		{"openai with key", ProviderConfig{Provider: "openai", Model: "gpt", APIKey: "sk"}, true},
		{"anthropic without key", ProviderConfig{Provider: "anthropic", Model: "claude"}, false},
		{"anthropic with key", ProviderConfig{Provider: "anthropic", Model: "claude", APIKey: "sk"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.cfg.Configured(); got != tc.want {
				t.Fatalf("Configured() = %v, want %v", got, tc.want)
			}
		})
	}
}
