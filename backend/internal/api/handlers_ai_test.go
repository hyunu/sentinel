package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func TestAIStatusUnconfigured(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewHandler(nil, zap.NewNop(), nil)
	router := gin.New()
	router.GET("/ai/status", handler.AIStatus)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/ai/status", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if response["configured"] != false {
		t.Fatalf("response = %#v", response)
	}
	if response["tools"] != float64(aiToolCount) {
		t.Fatalf("tools = %#v", response["tools"])
	}
}

func TestAIQueryWithoutProviderReturns503(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewHandler(nil, zap.NewNop(), nil)
	router := gin.New()
	router.POST("/ai/query", handler.AIQuery)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/ai/query", strings.NewReader(`{"board_id":"x","query":"hello"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if response["code"] != "ai_not_configured" {
		t.Fatalf("response = %#v", response)
	}
}

func TestAIQueryRequiresToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewHandler(nil, zap.NewNop(), nil, HandlerOptions{AIToken: "secret", RateLimit: 100})
	router := gin.New()
	router.POST("/ai/query", handler.AIQuery)

	body := `{"board_id":"x","query":"hello"}`
	request := httptest.NewRequest(http.MethodPost, "/ai/query", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("missing token status = %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/ai/query", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer secret")
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("valid token status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestAIQueryRateLimited(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewHandler(nil, zap.NewNop(), nil, HandlerOptions{RateLimit: 1})
	router := gin.New()
	router.POST("/ai/query", handler.AIQuery)

	body := `{"board_id":"x","query":"hello"}`
	for i := 0; i < 2; i++ {
		request := httptest.NewRequest(http.MethodPost, "/ai/query", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if i == 0 && recorder.Code != http.StatusServiceUnavailable {
			t.Fatalf("first status = %d", recorder.Code)
		}
		if i == 1 && recorder.Code != http.StatusTooManyRequests {
			t.Fatalf("second status = %d body=%s", recorder.Code, recorder.Body.String())
		}
	}
}
