package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hyunu/sentinel/internal/ai"
	"github.com/hyunu/sentinel/internal/config"
	"github.com/hyunu/sentinel/internal/db"
	"github.com/hyunu/sentinel/internal/models"
	"go.uber.org/zap"
)

type integrationAIProvider struct {
	responses []ai.ChatResponse
	requests  []ai.ChatRequest
}

func (p *integrationAIProvider) Name() string  { return "integration-fake" }
func (p *integrationAIProvider) Model() string { return "integration-model" }

func (p *integrationAIProvider) Chat(_ context.Context, req ai.ChatRequest) (ai.ChatResponse, error) {
	p.requests = append(p.requests, req)
	if len(p.responses) == 0 {
		return ai.ChatResponse{}, fmt.Errorf("no scripted response")
	}
	resp := p.responses[0]
	p.responses = p.responses[1:]
	return resp, nil
}

// TestAIToolsIntegration exercises the Mongo aggregations used by the AI tools.
// It is skipped unless SENTINEL_TEST_MONGO_URI is set, so normal unit tests do
// not require a database.
func TestAIToolsIntegration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	uri := os.Getenv("SENTINEL_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set SENTINEL_TEST_MONGO_URI to run AI tool integration tests")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	databaseName := fmt.Sprintf("sentinel_ai_test_%d", time.Now().UnixNano())
	database, err := db.New(&config.MongoDBConfig{URI: uri, Database: databaseName}, zap.NewNop())
	if err != nil {
		t.Fatalf("connect mongo: %v", err)
	}
	defer func() {
		_ = database.Collection("boards").Database().Drop(context.Background())
		_ = database.Close(context.Background())
	}()

	base := time.Now().UTC().Add(-30 * time.Minute).Truncate(time.Second)
	board := models.Board{
		ID:        "board-ai-test",
		UID:       "9999",
		Name:      "AI Test Board",
		CreatedAt: base,
		UpdatedAt: base,
	}
	if _, err := database.Boards().InsertOne(ctx, board); err != nil {
		t.Fatalf("insert board: %v", err)
	}

	values := []float64{20, 31, 35, 22, 40, 18}
	for i, value := range values {
		doc := models.UartData{
			ID:        fmt.Sprintf("frame-%d", i),
			BoardID:   board.ID,
			Timestamp: base.Add(time.Duration(i) * time.Minute),
			RawHex:    "AA00",
			Direction: "RX",
			ParsedFields: map[string]interface{}{
				"payload.temperature_celsius": value,
				"payload.humidity_percent":    float64(40 + i),
				"seq_no":                      int32(i),
			},
		}
		if _, err := database.UartData().InsertOne(ctx, doc); err != nil {
			t.Fatalf("insert uart: %v", err)
		}
	}

	handler := NewHandler(database, zap.NewNop(), nil)
	exec := &aiToolExecutor{h: handler, boardID: board.ID, protocolID: "proto-test"}
	start := base.Add(-time.Minute).Format(time.RFC3339)
	end := base.Add(time.Hour).Format(time.RFC3339)

	t.Run("stats", func(t *testing.T) {
		raw := json.RawMessage(fmt.Sprintf(`{"field":"payload.temperature_celsius","start":%q,"end":%q}`, start, end))
		out, err := exec.stats(ctx, raw)
		if err != nil {
			t.Fatalf("stats: %v", err)
		}
		payload := out.(map[string]any)
		stats := payload["stats"].(aiFieldStats)
		if stats.Count != 6 {
			t.Fatalf("stats = %#v", stats)
		}
		if stats.Min == nil || *stats.Min != 18 || stats.Max == nil || *stats.Max != 40 {
			t.Fatalf("min/max = %#v", stats)
		}
	})

	t.Run("list fields", func(t *testing.T) {
		raw := json.RawMessage(fmt.Sprintf(`{"start":%q,"end":%q}`, start, end))
		out, err := exec.listFields(ctx, raw)
		if err != nil {
			t.Fatalf("listFields: %v", err)
		}
		fields := out.(map[string]any)["fields"].([]map[string]any)
		found := false
		for _, field := range fields {
			if field["name"] == "payload.temperature_celsius" && field["numeric"] == true {
				found = true
			}
		}
		if !found {
			t.Fatalf("fields = %#v", fields)
		}
	})

	t.Run("series", func(t *testing.T) {
		raw := json.RawMessage(fmt.Sprintf(`{"field":"payload.temperature_celsius","start":%q,"end":%q,"include_stats":false}`, start, end))
		out, err := exec.querySeries(ctx, raw)
		if err != nil {
			t.Fatalf("querySeries: %v", err)
		}
		points := out.(map[string]any)["points"].([]aiSeriesPoint)
		if len(points) != 6 {
			t.Fatalf("points = %#v", points)
		}
		if points[0].Value != 20 || points[5].Value != 18 {
			t.Fatalf("points = %#v", points)
		}
	})

	t.Run("events", func(t *testing.T) {
		raw := json.RawMessage(fmt.Sprintf(`{"field":"payload.temperature_celsius","op":">","value":30,"start":%q,"end":%q}`, start, end))
		out, err := exec.findEvents(ctx, raw)
		if err != nil {
			t.Fatalf("findEvents: %v", err)
		}
		events := out.(map[string]any)["events"].([]eventInterval)
		if len(events) != 2 {
			t.Fatalf("events = %#v", events)
		}
		if events[0].Count != 2 || events[0].Max != 35 {
			t.Fatalf("first event = %#v", events[0])
		}
	})

	t.Run("handler", func(t *testing.T) {
		provider := &integrationAIProvider{responses: []ai.ChatResponse{
			{ToolCalls: []ai.ToolCall{{
				ID:        "call_1",
				Name:      "stats",
				Arguments: json.RawMessage(`{"field":"payload.temperature_celsius"}`),
			}}},
			{Content: "최근 1시간 평균 온도는 27.7도입니다."},
		}}
		agent := ai.NewAgent(provider, ai.Options{MaxRounds: 3}, zap.NewNop())
		router := SetupRouter(database, zap.NewNop(), agent)

		body := `{"board_id":"board-ai-test","query":"온도 통계 알려줘"}`
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/v1/ai/query", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
		}
		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if response["answer"] != "최근 1시간 평균 온도는 27.7도입니다." {
			t.Fatalf("response = %#v", response)
		}
		toolCalls, ok := response["tool_calls"].([]any)
		if !ok || len(toolCalls) != 1 {
			t.Fatalf("tool_calls = %#v", response["tool_calls"])
		}
		if len(provider.requests) != 2 {
			t.Fatalf("provider requests = %d", len(provider.requests))
		}
		lastToolMessage := provider.requests[1].Messages[len(provider.requests[1].Messages)-1]
		if lastToolMessage.Role != ai.RoleTool || !strings.Contains(lastToolMessage.Content, `"count":6`) {
			t.Fatalf("tool message = %#v", lastToolMessage)
		}
	})

	t.Run("openai provider end to end", func(t *testing.T) {
		calls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			if r.URL.Path != "/v1/chat/completions" {
				t.Errorf("path = %q", r.URL.Path)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode request: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			if calls == 1 {
				tools, _ := body["tools"].([]any)
				if len(tools) != aiToolCount {
					t.Errorf("tools = %d", len(tools))
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"choices": []any{map[string]any{
						"message": map[string]any{
							"content": "",
							"tool_calls": []any{map[string]any{
								"id":   "call_1",
								"type": "function",
								"function": map[string]any{
									"name":      "stats",
									"arguments": `{"field":"payload.temperature_celsius"}`,
								},
							}},
						},
						"finish_reason": "tool_calls",
					}},
				})
				return
			}
			messages, _ := body["messages"].([]any)
			if len(messages) == 0 {
				t.Errorf("missing messages")
			} else {
				last, _ := messages[len(messages)-1].(map[string]any)
				if last["role"] != "tool" || !strings.Contains(fmt.Sprint(last["content"]), `"count":6`) {
					t.Errorf("last message = %#v", last)
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []any{map[string]any{
					"message":       map[string]any{"content": "통계 조회를 완료했습니다."},
					"finish_reason": "stop",
				}},
				"usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
			})
		}))
		defer server.Close()

		provider, err := ai.NewProvider(ai.ProviderConfig{
			Provider: "openai",
			BaseURL:  server.URL + "/v1",
			APIKey:   "test-key",
			Model:    "fake-model",
			Timeout:  5 * time.Second,
		})
		if err != nil {
			t.Fatalf("NewProvider: %v", err)
		}
		agent := ai.NewAgent(provider, ai.Options{MaxRounds: 3}, zap.NewNop())
		router := SetupRouter(database, zap.NewNop(), agent)

		body := `{"board_id":"board-ai-test","query":"온도 통계 알려줘"}`
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/v1/ai/query", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
		}
		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if response["answer"] != "통계 조회를 완료했습니다." {
			t.Fatalf("response = %#v", response)
		}
		if calls != 2 {
			t.Fatalf("provider calls = %d", calls)
		}
	})
}
