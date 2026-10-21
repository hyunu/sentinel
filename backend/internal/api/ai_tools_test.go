package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hyunu/sentinel/internal/protocol"
	"go.uber.org/zap"
)

func TestAIToolRegistrySchemas(t *testing.T) {
	handler := NewHandler(nil, zap.NewNop(), nil)
	registry := handler.buildAIToolRegistry("board-1", "proto-1")
	if registry.Len() != aiToolCount {
		t.Fatalf("tool count = %d, want %d", registry.Len(), aiToolCount)
	}

	names := make(map[string]bool)
	for _, spec := range registry.Specs() {
		names[spec.Name] = true
		if spec.Description == "" {
			t.Errorf("tool %q has no description", spec.Name)
		}
		if !json.Valid(spec.Parameters) {
			t.Errorf("tool %q has invalid JSON schema: %s", spec.Name, spec.Parameters)
		}
	}
	for _, want := range []string{
		"list_boards", "get_board", "list_protocols", "get_protocol",
		"list_fields", "stats", "query_series", "find_events",
		"find_anomalies", "compare_sessions",
		"list_sessions", "query_raw", "propose_chart",
	} {
		if !names[want] {
			t.Errorf("missing tool %q", want)
		}
	}
}

func TestClampAILimit(t *testing.T) {
	cases := []struct {
		value, fallback, max, want int
	}{
		{0, 20, 100, 20},
		{-1, 20, 100, 20},
		{50, 20, 100, 50},
		{500, 20, 100, 100},
	}
	for _, tc := range cases {
		if got := clampAILimit(tc.value, tc.fallback, tc.max); got != tc.want {
			t.Errorf("clampAILimit(%d, %d, %d) = %d, want %d", tc.value, tc.fallback, tc.max, got, tc.want)
		}
	}
}

func TestCollectParseRuleFieldPathsFromTemperatureRules(t *testing.T) {
	spec := protocol.TemperatureTelemetrySpec(protocol.TemperatureProtocolID)
	paths := collectParseRuleFieldPaths(spec.ParseRules)
	got := make(map[string]bool, len(paths))
	for _, path := range paths {
		got[path] = true
	}

	for _, want := range []string{
		"fid",
		"seq_no",
		"payload.sensor_id",
		"payload.temperature_celsius",
		"payload.humidity_percent",
	} {
		if !got[want] {
			t.Errorf("missing field path %q in %v", want, paths)
		}
	}
	for _, unwanted := range []string{"stx", "etx", "crc16", "length", "payload"} {
		if got[unwanted] {
			t.Errorf("unexpected field path %q in %v", unwanted, paths)
		}
	}
}

func TestCollectParseRuleFieldPathsFromLCPRules(t *testing.T) {
	rules := protocol.DefaultLCPParseRules()
	paths := collectParseRuleFieldPaths(&rules)
	joined := strings.Join(paths, "\n")

	for _, want := range []string{
		"fid",
		"seq_no",
		"payload.function_count",
		"payload.functions.function_id",
		"payload.functions.args.val",
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing field path %q in %v", want, paths)
		}
	}
	for _, unwanted := range []string{"stx", "etx", "crc16", "length"} {
		if strings.Contains(joined, unwanted+"\n") || joined == unwanted {
			t.Errorf("unexpected field path %q in %v", unwanted, paths)
		}
	}
}

func TestResolveTimeWindow(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	hourAgo := now.Add(-time.Hour)

	t.Run("default last hour", func(t *testing.T) {
		window, err := resolveTimeWindow("", "", 0, now, 0)
		if err != nil {
			t.Fatalf("resolveTimeWindow: %v", err)
		}
		if !window.Start.Equal(hourAgo) || !window.End.Equal(now) {
			t.Fatalf("window = %#v", window)
		}
	})

	t.Run("last minutes", func(t *testing.T) {
		window, err := resolveTimeWindow("", "", 15, now, 0)
		if err != nil {
			t.Fatalf("resolveTimeWindow: %v", err)
		}
		if !window.Start.Equal(now.Add(-15 * time.Minute)) {
			t.Fatalf("start = %v", window.Start)
		}
	})

	t.Run("explicit range", func(t *testing.T) {
		start := "2026-10-21T09:00:00Z"
		end := "2026-10-21T10:30:00Z"
		window, err := resolveTimeWindow(start, end, 0, now, 0)
		if err != nil {
			t.Fatalf("resolveTimeWindow: %v", err)
		}
		if window.Start.Format(time.RFC3339) != start || window.End.Format(time.RFC3339) != end {
			t.Fatalf("window = %#v", window)
		}
	})

	t.Run("end only", func(t *testing.T) {
		end := "2026-10-21T10:00:00Z"
		window, err := resolveTimeWindow("", end, 0, now, 0)
		if err != nil {
			t.Fatalf("resolveTimeWindow: %v", err)
		}
		if !window.End.Equal(time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC)) || !window.Start.Equal(window.End.Add(-time.Hour)) {
			t.Fatalf("window = %#v", window)
		}
	})

	t.Run("invalid timestamp", func(t *testing.T) {
		if _, err := resolveTimeWindow("yesterday", "", 0, now, 0); err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("start after end", func(t *testing.T) {
		if _, err := resolveTimeWindow("2026-10-21T11:00:00Z", "2026-10-21T10:00:00Z", 0, now, 0); err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("max span", func(t *testing.T) {
		if _, err := resolveTimeWindow("2026-10-20T00:00:00Z", "2026-10-21T00:00:00Z", 0, now, 12*time.Hour); err == nil {
			t.Fatal("expected error")
		}
	})
}

func TestDetectEvents(t *testing.T) {
	base := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	samples := []eventSample{
		{Timestamp: base, Value: 1},
		{Timestamp: base.Add(10 * time.Second), Value: 4},
		{Timestamp: base.Add(20 * time.Second), Value: 5},
		{Timestamp: base.Add(30 * time.Second), Value: 2},
		{Timestamp: base.Add(40 * time.Second), Value: 6},
		{Timestamp: base.Add(50 * time.Second), Value: 7},
	}

	events := detectEvents(samples, ">", 3, 0)
	if len(events) != 2 {
		t.Fatalf("events = %#v", events)
	}
	first := events[0]
	if !first.Start.Equal(samples[1].Timestamp) || !first.End.Equal(samples[2].Timestamp) {
		t.Fatalf("first interval = %#v", first)
	}
	if first.DurationSeconds != 10 || first.Count != 2 || first.Min != 4 || first.Max != 5 {
		t.Fatalf("first stats = %#v", first)
	}
	if !events[1].Start.Equal(samples[4].Timestamp) || !events[1].End.Equal(samples[5].Timestamp) {
		t.Fatalf("second interval = %#v", events[1])
	}

	if got := detectEvents(samples, ">", 3, 15*time.Second); len(got) != 0 {
		t.Fatalf("min duration should filter events: %#v", got)
	}
	if got := detectEvents(samples, ">=", 7, 0); len(got) != 1 || got[0].Max != 7 {
		t.Fatalf(">= events = %#v", got)
	}
	if got := detectEvents(samples, "==", 4, 0); len(got) != 1 || got[0].Count != 1 {
		t.Fatalf("== events = %#v", got)
	}
}

func TestDetectEventsLowThreshold(t *testing.T) {
	base := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	samples := []eventSample{
		{Timestamp: base, Value: 1},
		{Timestamp: base.Add(time.Second), Value: 1},
		{Timestamp: base.Add(2 * time.Second), Value: 5},
	}
	events := detectEvents(samples, "<", 3, 0)
	if len(events) != 1 {
		t.Fatalf("events = %#v", events)
	}
	if events[0].DurationSeconds != 1 || events[0].Count != 2 {
		t.Fatalf("event = %#v", events[0])
	}
}

func TestDetectAnomaliesZScore(t *testing.T) {
	base := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	samples := []eventSample{
		{Timestamp: base, Value: 0},
		{Timestamp: base.Add(time.Second), Value: 0},
		{Timestamp: base.Add(2 * time.Second), Value: 0},
		{Timestamp: base.Add(3 * time.Second), Value: 0},
		{Timestamp: base.Add(4 * time.Second), Value: 0},
		{Timestamp: base.Add(5 * time.Second), Value: 10},
	}
	summary, points, err := detectAnomalies(samples, "zscore", 2, 10)
	if err != nil {
		t.Fatalf("detectAnomalies: %v", err)
	}
	if summary.Method != "zscore" || summary.Count != 1 {
		t.Fatalf("summary = %#v", summary)
	}
	if len(points) != 1 || points[0].Value != 10 {
		t.Fatalf("points = %#v", points)
	}
	if points[0].Score < 2 {
		t.Fatalf("score = %v", points[0].Score)
	}
}

func TestDetectAnomaliesIQR(t *testing.T) {
	base := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	values := []float64{1, 2, 3, 4, 5, 6, 100}
	samples := make([]eventSample, len(values))
	for i, value := range values {
		samples[i] = eventSample{Timestamp: base.Add(time.Duration(i) * time.Second), Value: value}
	}
	summary, points, err := detectAnomalies(samples, "iqr", 1.5, 10)
	if err != nil {
		t.Fatalf("detectAnomalies: %v", err)
	}
	if summary.Method != "iqr" || summary.Count != 1 {
		t.Fatalf("summary = %#v", summary)
	}
	if len(points) != 1 || points[0].Value != 100 {
		t.Fatalf("points = %#v", points)
	}
	if summary.Q1 == nil || summary.Q3 == nil || summary.Upper == nil {
		t.Fatalf("missing quartiles: %#v", summary)
	}
	if *summary.Upper >= 100 {
		t.Fatalf("upper bound = %v", *summary.Upper)
	}
}

func TestDetectAnomaliesChangePoint(t *testing.T) {
	base := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	values := []float64{1, 1, 1, 10, 10, 10}
	samples := make([]eventSample, len(values))
	for i, value := range values {
		samples[i] = eventSample{Timestamp: base.Add(time.Duration(i) * time.Second), Value: value}
	}
	summary, points, err := detectAnomalies(samples, "change_point", 0.5, 10)
	if err != nil {
		t.Fatalf("detectAnomalies: %v", err)
	}
	if summary.Method != "change_point" || summary.Count != 1 {
		t.Fatalf("summary = %#v", summary)
	}
	if len(points) != 1 || points[0].Value != 10 {
		t.Fatalf("points = %#v", points)
	}
}

func TestDetectAnomaliesRejectsUnknownMethod(t *testing.T) {
	if _, _, err := detectAnomalies(nil, "magic", 1, 10); err == nil {
		t.Fatal("expected error")
	}
}

func TestPercentChange(t *testing.T) {
	if got := percentChange(10, 15); got == nil || *got != 50 {
		t.Fatalf("percentChange(10,15) = %v", got)
	}
	if got := percentChange(10, 5); got == nil || *got != -50 {
		t.Fatalf("percentChange(10,5) = %v", got)
	}
	if got := percentChange(0, 5); got != nil {
		t.Fatalf("percentChange(0,5) = %v", got)
	}
}

func TestValidateFieldName(t *testing.T) {
	valid := []string{"temperature_celsius", "payload.temperature_celsius", "functions[0].value", "fid"}
	for _, name := range valid {
		if err := validateFieldName(name); err != nil {
			t.Errorf("validateFieldName(%q) = %v", name, err)
		}
	}
	invalid := []string{"", " ", "$where", "a b", "a\nb", "a\x00b"}
	for _, name := range invalid {
		if err := validateFieldName(name); err == nil {
			t.Errorf("validateFieldName(%q) should fail", name)
		}
	}
}
