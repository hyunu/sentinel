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
	"go.mongodb.org/mongo-driver/bson"
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

type integrationStreamProvider struct{}

func (p *integrationStreamProvider) Name() string  { return "integration-stream" }
func (p *integrationStreamProvider) Model() string { return "integration-stream-model" }
func (p *integrationStreamProvider) Chat(_ context.Context, _ ai.ChatRequest) (ai.ChatResponse, error) {
	return ai.ChatResponse{}, fmt.Errorf("Chat should not be called")
}
func (p *integrationStreamProvider) ChatStream(_ context.Context, _ ai.ChatRequest, onToken func(string) error) (ai.ChatResponse, error) {
	for _, token := range []string{"스트림", " 응답"} {
		if err := onToken(token); err != nil {
			return ai.ChatResponse{}, err
		}
	}
	return ai.ChatResponse{Content: "스트림 응답"}, nil
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

	sessions := []interface{}{
		models.Session{
			ID:        "session-a",
			BoardID:   board.ID,
			Name:      "Session A",
			StartTime: base.Add(-time.Minute),
			EndTime:   base.Add(2 * time.Minute),
			CreatedAt: base,
		},
		models.Session{
			ID:        "session-b",
			BoardID:   board.ID,
			Name:      "Session B",
			StartTime: base.Add(3 * time.Minute),
			EndTime:   base.Add(10 * time.Minute),
			CreatedAt: base,
		},
	}
	if _, err := database.Sessions().InsertMany(ctx, sessions); err != nil {
		t.Fatalf("insert sessions: %v", err)
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

	t.Run("server aggregation", func(t *testing.T) {
		windowStart, _ := time.Parse(time.RFC3339, start)
		windowEnd, _ := time.Parse(time.RFC3339, end)
		filter := bson.M{
			"board_id":  board.ID,
			"timestamp": bson.M{"$gte": windowStart, "$lte": windowEnd},
		}
		items := []models.VizItem{{
			Label:    "temperature",
			FieldRef: models.FieldRef{FieldName: "payload.temperature_celsius"},
		}}
		points, meta, err := handler.queryVizSeriesAggregated(ctx, filter, items, "avg", 120, 100)
		if err != nil {
			t.Fatalf("queryVizSeriesAggregated: %v", err)
		}
		if len(points) < 2 || len(points) >= 6 {
			t.Fatalf("expected aggregated points, got %#v", points)
		}
		if meta.TotalMatched != 6 || meta.Downsampled {
			t.Fatalf("meta = %#v", meta)
		}
		for _, point := range points {
			value, ok := point.Values["temperature"].(float64)
			if !ok || value < 18 || value > 40 {
				t.Fatalf("unexpected aggregated point %#v", point)
			}
		}
	})

	t.Run("anomalies", func(t *testing.T) {
		raw := json.RawMessage(fmt.Sprintf(`{"field":"payload.temperature_celsius","method":"zscore","threshold":1.2,"start":%q,"end":%q}`, start, end))
		out, err := exec.findAnomalies(ctx, raw)
		if err != nil {
			t.Fatalf("findAnomalies: %v", err)
		}
		payload := out.(map[string]any)
		anomalies := payload["anomalies"].([]anomalyPoint)
		if len(anomalies) == 0 {
			t.Fatalf("expected anomalies: %#v", payload)
		}
		if anomalies[0].Score == 0 {
			t.Fatalf("anomaly score missing: %#v", anomalies[0])
		}
	})

	t.Run("compare sessions", func(t *testing.T) {
		raw := json.RawMessage(`{"field":"payload.temperature_celsius","session_ids":["session-a","session-b"]}`)
		out, err := exec.compareSessions(ctx, raw)
		if err != nil {
			t.Fatalf("compareSessions: %v", err)
		}
		payload := out.(map[string]any)
		comparisons := payload["sessions"].([]sessionComparison)
		if len(comparisons) != 2 {
			t.Fatalf("comparisons = %#v", comparisons)
		}
		if comparisons[0].Stats.Avg == nil || comparisons[1].DeltaPercent == nil {
			t.Fatalf("comparison stats = %#v", comparisons)
		}
		if *comparisons[1].DeltaPercent >= 0 {
			t.Fatalf("expected negative delta: %#v", comparisons[1])
		}
	})

	t.Run("create session assigns data", func(t *testing.T) {
		router := SetupRouter(database, zap.NewNop(), nil)
		body := fmt.Sprintf(
			`{"board_id":%q,"name":"Manual Session","start_time":%q,"end_time":%q}`,
			board.ID,
			base.Add(-time.Minute).Format(time.RFC3339),
			base.Add(time.Minute).Format(time.RFC3339),
		)
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusCreated {
			t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
		}
		var session models.Session
		if err := json.Unmarshal(recorder.Body.Bytes(), &session); err != nil {
			t.Fatalf("decode: %v", err)
		}
		count, err := database.UartData().CountDocuments(ctx, bson.M{"session_id": session.ID})
		if err != nil {
			t.Fatalf("count assigned: %v", err)
		}
		if count != 2 {
			t.Fatalf("assigned frames = %d, want 2", count)
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

	t.Run("streaming handler", func(t *testing.T) {
		agent := ai.NewAgent(&integrationStreamProvider{}, ai.Options{MaxRounds: 2}, zap.NewNop())
		router := SetupRouter(database, zap.NewNop(), agent)

		body := `{"board_id":"board-ai-test","query":"스트리밍 테스트"}`
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/v1/ai/query/stream", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
		}
		if !strings.HasPrefix(recorder.Header().Get("Content-Type"), "text/event-stream") {
			t.Fatalf("content type = %q", recorder.Header().Get("Content-Type"))
		}
		stream := recorder.Body.String()
		for _, want := range []string{
			`"type":"round"`,
			`"type":"token","content":"스트림"`,
			`"type":"token","content":" 응답"`,
			`"type":"done"`,
			`"answer":"스트림 응답"`,
		} {
			if !strings.Contains(stream, want) {
				t.Fatalf("stream missing %q:\n%s", want, stream)
			}
		}
	})
}
