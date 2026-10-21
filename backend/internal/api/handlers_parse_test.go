package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hyunu/sentinel/internal/protocol"
	"go.uber.org/zap"
)

func TestParseProtocolHexBatch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	spec := protocol.TemperatureTelemetrySpec(protocol.TemperatureProtocolID)
	frame1, _, err := protocol.BuildTemperatureFrameFromValue(1, 36.5)
	if err != nil {
		t.Fatalf("build frame1: %v", err)
	}
	frame2, _, err := protocol.BuildTemperatureFrameFromValue(2, 21.25)
	if err != nil {
		t.Fatalf("build frame2: %v", err)
	}

	payload, err := json.Marshal(map[string]any{
		"parse_rules": spec.ParseRules,
		"frames":      []string{frame1, frame2, "not-hex"},
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	handler := NewHandler(nil, zap.NewNop(), nil)
	router := gin.New()
	router.POST("/parse/batch", handler.ParseProtocolHexBatch)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/parse/batch", strings.NewReader(string(payload)))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Results []struct {
			RawHex       string         `json:"raw_hex"`
			ParsedFields map[string]any `json:"parsed_fields"`
			Error        string         `json:"error"`
		} `json:"results"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Results) != 3 {
		t.Fatalf("results = %#v", response.Results)
	}
	if response.Results[0].ParsedFields["payload.temperature_celsius"] == nil {
		t.Fatalf("first parsed = %#v", response.Results[0])
	}
	if response.Results[2].Error == "" {
		t.Fatalf("invalid frame should have an error: %#v", response.Results[2])
	}
}
