package api

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type aiRateBucket struct {
	used  int
	reset time.Time
}

type aiRateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]*aiRateBucket
	now     func() time.Time
}

func newAIRateLimiter(perMinute int, windowMinutes int) *aiRateLimiter {
	if perMinute <= 0 {
		perMinute = 30
	}
	if windowMinutes <= 0 {
		windowMinutes = 1
	}
	return &aiRateLimiter{
		limit:   perMinute,
		window:  time.Duration(windowMinutes) * time.Minute,
		buckets: make(map[string]*aiRateBucket),
		now:     time.Now,
	}
}

func (l *aiRateLimiter) allow(key string) bool {
	if l == nil {
		return true
	}
	if key == "" {
		key = "unknown"
	}
	now := l.now()

	l.mu.Lock()
	defer l.mu.Unlock()

	if len(l.buckets) > 10000 {
		for bucketKey, bucket := range l.buckets {
			if now.After(bucket.reset) {
				delete(l.buckets, bucketKey)
			}
		}
	}

	bucket := l.buckets[key]
	if bucket == nil || now.After(bucket.reset) {
		bucket = &aiRateBucket{reset: now.Add(l.window)}
		l.buckets[key] = bucket
	}
	if bucket.used >= l.limit {
		return false
	}
	bucket.used++
	return true
}

// authorizeAI enforces the optional AI token and the in-memory rate limit.
func (h *Handler) authorizeAI(c *gin.Context) bool {
	if h.aiToken != "" {
		token := strings.TrimSpace(c.GetHeader("X-AI-Token"))
		if token == "" {
			auth := strings.TrimSpace(c.GetHeader("Authorization"))
			if strings.HasPrefix(auth, "Bearer ") {
				token = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
			}
		}
		if subtle.ConstantTimeCompare([]byte(token), []byte(h.aiToken)) != 1 {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "AI authorization required",
				"code":  "ai_unauthorized",
			})
			return false
		}
	}
	if h.aiLimiter != nil && !h.aiLimiter.allow(c.ClientIP()) {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": "AI rate limit exceeded. Try again later.",
			"code":  "ai_rate_limited",
		})
		return false
	}
	return true
}
