package api

import (
	"testing"
	"time"
)

func TestAIRateLimiter(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	limiter := newAIRateLimiter(2, 1)
	limiter.now = func() time.Time { return now }

	if !limiter.allow("client-a") || !limiter.allow("client-a") {
		t.Fatal("first two requests should be allowed")
	}
	if limiter.allow("client-a") {
		t.Fatal("third request should be rate limited")
	}
	if !limiter.allow("client-b") {
		t.Fatal("other clients should not be affected")
	}

	now = now.Add(61 * time.Second)
	if !limiter.allow("client-a") {
		t.Fatal("request after the window should be allowed")
	}
}
