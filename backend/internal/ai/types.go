package ai

import (
	"context"
	"encoding/json"
	"time"
)

// Role is a provider-neutral chat role.
type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

// Message is a provider-neutral chat message.
type Message struct {
	Role       Role       `json:"role"`
	Content    string     `json:"content,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	Name       string     `json:"name,omitempty"`
}

// ToolCall is a model request to execute a registered tool.
type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// ToolSpec describes a tool to the model. Parameters is a JSON Schema object.
type ToolSpec struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

// Usage reports provider token usage when available.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// ChatRequest is a provider-neutral completion request.
type ChatRequest struct {
	Messages    []Message
	Tools       []ToolSpec
	MaxTokens   int
	Temperature *float64
}

// ChatResponse is a provider-neutral completion response.
type ChatResponse struct {
	Content      string
	ToolCalls    []ToolCall
	FinishReason string
	Usage        *Usage
}

// Provider is the abstraction implemented by every AI backend.
type Provider interface {
	Name() string
	Model() string
	Chat(ctx context.Context, req ChatRequest) (ChatResponse, error)
}

// ProviderConfig is the provider-neutral configuration loaded from env.
type ProviderConfig struct {
	Provider string
	BaseURL  string
	APIKey   string
	Model    string
	Timeout  time.Duration
}

// ChartSpec is an optional visualization artifact returned by the agent.
type ChartSpec struct {
	BoardID     string   `json:"board_id"`
	ProtocolID  string   `json:"protocol_id,omitempty"`
	Fields      []string `json:"fields"`
	Start       string   `json:"start"`
	End         string   `json:"end"`
	Aggregation string   `json:"aggregation,omitempty"`
	Title       string   `json:"title,omitempty"`
}
