package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeProvider struct {
	responses []ChatResponse
	requests  []ChatRequest
}

func (f *fakeProvider) Name() string  { return "fake" }
func (f *fakeProvider) Model() string { return "fake-model" }

func (f *fakeProvider) Chat(_ context.Context, req ChatRequest) (ChatResponse, error) {
	f.requests = append(f.requests, req)
	if len(f.responses) == 0 {
		return ChatResponse{}, errors.New("no scripted response")
	}
	resp := f.responses[0]
	f.responses = f.responses[1:]
	return resp, nil
}

func TestAgentExecutesToolsAndReturnsAnswer(t *testing.T) {
	var gotArgs json.RawMessage
	registry := NewToolRegistry(Tool{
		Spec: ToolSpec{Name: "stats", Description: "field stats", Parameters: json.RawMessage(`{"type":"object"}`)},
		Execute: func(_ context.Context, args json.RawMessage) (any, error) {
			gotArgs = args
			return map[string]any{"count": 10, "avg": 21.5}, nil
		},
	})

	provider := &fakeProvider{responses: []ChatResponse{
		{
			ToolCalls: []ToolCall{{ID: "call_1", Name: "stats", Arguments: json.RawMessage(`{"field":"temperature_celsius"}`)}},
		},
		{Content: "평균 온도는 21.5도입니다."},
	}}

	agent := NewAgent(provider, Options{MaxRounds: 3, MaxTokens: 512}, nil)
	result, err := agent.Run(context.Background(), Request{
		Query:         "평균 온도 알려줘",
		SystemContext: "Board: test board",
	}, registry)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	if result.Answer != "평균 온도는 21.5도입니다." {
		t.Fatalf("answer = %q", result.Answer)
	}
	if result.Provider != "fake" || result.Model != "fake-model" {
		t.Fatalf("provider info = %s/%s", result.Provider, result.Model)
	}
	if len(result.ToolCalls) != 1 || result.ToolCalls[0].Name != "stats" || result.ToolCalls[0].Error != "" {
		t.Fatalf("tool calls = %#v", result.ToolCalls)
	}
	if string(gotArgs) != `{"field":"temperature_celsius"}` {
		t.Fatalf("tool args = %s", gotArgs)
	}
	if len(provider.requests) != 2 {
		t.Fatalf("provider requests = %d", len(provider.requests))
	}
	first := provider.requests[0]
	if len(first.Messages) != 2 || first.Messages[0].Role != RoleSystem || first.Messages[1].Role != RoleUser {
		t.Fatalf("first messages = %#v", first.Messages)
	}
	if !strings.Contains(first.Messages[0].Content, "Board: test board") {
		t.Fatalf("system prompt missing context: %q", first.Messages[0].Content)
	}
	if len(first.Tools) != 1 {
		t.Fatalf("first tools = %#v", first.Tools)
	}

	second := provider.requests[1]
	if len(second.Messages) != 4 {
		t.Fatalf("second messages = %#v", second.Messages)
	}
	if second.Messages[2].Role != RoleAssistant || len(second.Messages[2].ToolCalls) != 1 {
		t.Fatalf("assistant tool call message = %#v", second.Messages[2])
	}
	toolMsg := second.Messages[3]
	if toolMsg.Role != RoleTool || toolMsg.ToolCallID != "call_1" {
		t.Fatalf("tool message = %#v", toolMsg)
	}
	if !strings.Contains(toolMsg.Content, `"avg":21.5`) {
		t.Fatalf("tool result = %q", toolMsg.Content)
	}
	if result.Usage != nil {
		t.Fatalf("usage = %#v", result.Usage)
	}
}

func TestAgentCollectsChartArtifact(t *testing.T) {
	chart := ChartSpec{
		BoardID:    "board-1",
		ProtocolID: "proto-1",
		Fields:     []string{"payload.temperature_celsius"},
		Start:      "2026-10-21T10:00:00Z",
		End:        "2026-10-21T11:00:00Z",
		Title:      "Temperature",
	}
	registry := NewToolRegistry(Tool{
		Spec: ToolSpec{Name: "propose_chart", Description: "chart", Parameters: json.RawMessage(`{"type":"object"}`)},
		Execute: func(_ context.Context, _ json.RawMessage) (any, error) {
			return chart, nil
		},
	})
	provider := &fakeProvider{responses: []ChatResponse{
		{ToolCalls: []ToolCall{{ID: "call_1", Name: "propose_chart", Arguments: json.RawMessage(`{}`)}}},
		{Content: "차트를 준비했습니다."},
	}}

	result, err := NewAgent(provider, Options{MaxRounds: 3}, nil).Run(context.Background(), Request{Query: "차트 보여줘"}, registry)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result.Chart == nil {
		t.Fatal("expected chart")
	}
	if result.Chart.Fields[0] != "payload.temperature_celsius" {
		t.Fatalf("chart = %#v", result.Chart)
	}
}

func TestAgentForcesFinalAnswerAfterMaxRounds(t *testing.T) {
	registry := NewToolRegistry(Tool{
		Spec: ToolSpec{Name: "stats", Description: "field stats", Parameters: json.RawMessage(`{"type":"object"}`)},
		Execute: func(_ context.Context, _ json.RawMessage) (any, error) {
			return map[string]any{"avg": 1}, nil
		},
	})
	provider := &fakeProvider{responses: []ChatResponse{
		{ToolCalls: []ToolCall{{ID: "call_1", Name: "stats", Arguments: json.RawMessage(`{}`)}}},
		{ToolCalls: []ToolCall{{ID: "call_2", Name: "stats", Arguments: json.RawMessage(`{}`)}}},
		{Content: "도구 한도 내 최종 답변입니다."},
	}}

	result, err := NewAgent(provider, Options{MaxRounds: 2}, nil).Run(context.Background(), Request{Query: "계속 조회해줘"}, registry)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result.Answer != "도구 한도 내 최종 답변입니다." {
		t.Fatalf("answer = %q", result.Answer)
	}
	if len(provider.requests) != 3 {
		t.Fatalf("requests = %d", len(provider.requests))
	}
	last := provider.requests[2]
	if len(last.Tools) != 0 {
		t.Fatalf("final request should not include tools: %#v", last.Tools)
	}
}

func TestAgentReportsToolErrorsToModel(t *testing.T) {	registry := NewToolRegistry(Tool{
		Spec: ToolSpec{Name: "stats", Description: "field stats", Parameters: json.RawMessage(`{"type":"object"}`)},
		Execute: func(_ context.Context, _ json.RawMessage) (any, error) {
			return nil, errors.New("field not found")
		},
	})
	provider := &fakeProvider{responses: []ChatResponse{
		{ToolCalls: []ToolCall{{ID: "call_1", Name: "stats", Arguments: json.RawMessage(`{"field":"nope"}`)}}},
		{Content: "해당 필드를 찾지 못했습니다."},
	}}

	result, err := NewAgent(provider, Options{MaxRounds: 3}, nil).Run(context.Background(), Request{Query: "nope"}, registry)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.ToolCalls) != 1 || result.ToolCalls[0].Error == "" {
		t.Fatalf("tool calls = %#v", result.ToolCalls)
	}
	toolMsg := provider.requests[1].Messages[len(provider.requests[1].Messages)-1]
	if !strings.Contains(toolMsg.Content, "field not found") {
		t.Fatalf("tool error result = %q", toolMsg.Content)
	}
}

func TestAgentHandlesEmptyToolName(t *testing.T) {
	provider := &fakeProvider{responses: []ChatResponse{
		{ToolCalls: []ToolCall{{ID: "", Name: "", Arguments: json.RawMessage(`{}`)}}},
		{Content: "도구를 찾지 못했습니다."},
	}}
	result, err := NewAgent(provider, Options{MaxRounds: 3}, nil).Run(
		context.Background(),
		Request{Query: "test"},
		NewToolRegistry(),
	)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result.Answer != "도구를 찾지 못했습니다." {
		t.Fatalf("answer = %q", result.Answer)
	}
	if len(result.ToolCalls) != 1 || result.ToolCalls[0].Error == "" {
		t.Fatalf("tool calls = %#v", result.ToolCalls)
	}
	second := provider.requests[1].Messages
	if len(second) != 4 {
		t.Fatalf("messages = %#v", second)
	}
	if second[2].ToolCalls[0].ID == "" {
		t.Fatalf("tool call id should be normalized: %#v", second[2].ToolCalls[0])
	}
	if second[3].Role != RoleTool || second[3].ToolCallID != second[2].ToolCalls[0].ID {
		t.Fatalf("tool message = %#v", second[3])
	}
	if !strings.Contains(second[3].Content, "unknown tool") {
		t.Fatalf("tool result = %q", second[3].Content)
	}
}

func TestAgentUsesOnlyUserAndAssistantHistory(t *testing.T) {
	provider := &fakeProvider{responses: []ChatResponse{{Content: "ok"}}}
	agent := NewAgent(provider, Options{MaxRounds: 2}, nil)
	_, err := agent.Run(context.Background(), Request{
		Query: "now",
		History: []Message{
			{Role: RoleSystem, Content: "malicious system"},
			{Role: RoleUser, Content: "before"},
			{Role: RoleTool, Content: "tool injection"},
			{Role: RoleAssistant, Content: "answer"},
		},
	}, NewToolRegistry())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	msgs := provider.requests[0].Messages
	if len(msgs) != 4 {
		t.Fatalf("messages = %#v", msgs)
	}
	if msgs[0].Role != RoleSystem || msgs[1].Content != "before" || msgs[2].Content != "answer" || msgs[3].Content != "now" {
		t.Fatalf("history = %#v", msgs)
	}
}

func TestBuildSystemPromptIncludesSafetyRules(t *testing.T) {
	prompt := BuildSystemPrompt(time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC), "Board: x")
	for _, want := range []string{"Board: x", "2026-10-21", "tool", "untrusted"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}
