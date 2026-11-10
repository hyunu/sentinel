package api

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func testGinContext(query string) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/?"+query, nil)
	return c
}

func TestParseDataInclude(t *testing.T) {
	got, err := parseDataInclude("uart, temp, heartbeats", dataDumpDefaultInclude)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, key := range []string{"uart", "temperatures", "heartbeats"} {
		if !got[key] {
			t.Fatalf("expected %q in %v", key, got)
		}
	}
	if got["sessions"] {
		t.Fatalf("sessions should not be included: %v", got)
	}

	if _, err := parseDataInclude("bogus", dataDumpDefaultInclude); err == nil {
		t.Fatal("expected unknown include to fail")
	}

	fallback, err := parseDataInclude("", dataDeleteDefaultInclude)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !fallback["uart"] || !fallback["rollups"] {
		t.Fatalf("fallback include missing defaults: %v", fallback)
	}
}

func TestParseDataRange(t *testing.T) {
	c := testGinContext("since=2026-11-06T08:00:00Z&until=2026-11-06T09:00:00Z")
	since, until, err := parseDataRange(c)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if since == nil || until == nil || !since.Before(*until) {
		t.Fatalf("unexpected range: %v %v", since, until)
	}

	bad := testGinContext("since=2026-11-06T09:00:00Z&until=2026-11-06T08:00:00Z")
	if _, _, err := parseDataRange(bad); err == nil {
		t.Fatal("expected inverted range to fail")
	}

	empty := testGinContext("")
	since, until, err = parseDataRange(empty)
	if err != nil || since != nil || until != nil {
		t.Fatalf("empty range should be unbounded: %v %v %v", since, until, err)
	}
}

func TestDataRangeFilters(t *testing.T) {
	from := time.Date(2026, 11, 6, 8, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)

	ts := timestampRangeFilter("board-1", &from, &to)
	if ts["board_id"] != "board-1" {
		t.Fatalf("board filter missing: %v", ts)
	}
	if _, ok := ts["timestamp"]; !ok {
		t.Fatalf("timestamp filter missing: %v", ts)
	}

	bucket := bucketRangeFilter("board-1", &from, &to)
	if _, ok := bucket["bucket_start"]; !ok {
		t.Fatalf("bucket_start filter missing: %v", bucket)
	}
	if _, ok := bucket["timestamp"]; ok {
		t.Fatalf("bucket filter must not use timestamp: %v", bucket)
	}

	session := sessionRangeFilter("board-1", &from, &to)
	if _, ok := session["start_time"]; !ok {
		t.Fatalf("start_time filter missing: %v", session)
	}
}

func TestDeleteConfirmAndGzip(t *testing.T) {
	for _, value := range []string{"1", "true", "yes", "DELETE"} {
		c := testGinContext("confirm=" + value)
		if !deleteConfirm(c) {
			t.Fatalf("confirm=%q should be accepted", value)
		}
	}
	if deleteConfirm(testGinContext("confirm=false")) {
		t.Fatal("confirm=false must be rejected")
	}
	if deleteConfirm(testGinContext("")) {
		t.Fatal("missing confirm must be rejected")
	}

	if !gzipEnabled(testGinContext("gzip=true")) || gzipEnabled(testGinContext("gzip=0")) {
		t.Fatal("gzip flag parsing failed")
	}
}
