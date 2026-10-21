package config

import (
	"testing"
	"time"
)

func TestLoadAIConfigFromEnv(t *testing.T) {
	t.Setenv("AI_PROVIDER", "exaone")
	t.Setenv("AI_BASE_URL", "http://localhost:8000/v1")
	t.Setenv("AI_MODEL", "LGAI-EXAONE/EXAONE-4.0-32B")
	t.Setenv("AI_API_KEY", "local")
	t.Setenv("AI_API_TOKEN", "secret-token")
	t.Setenv("AI_RATE_LIMIT_PER_MINUTE", "12")
	t.Setenv("AI_MAX_TOKENS", "2048")
	t.Setenv("AI_TEMPERATURE", "0.3")
	t.Setenv("AI_TIMEOUT_SECONDS", "45")
	t.Setenv("AI_MAX_TOOL_ROUNDS", "4")

	cfg := Load()
	if cfg.AI.Provider != "exaone" {
		t.Fatalf("provider = %q", cfg.AI.Provider)
	}
	if cfg.AI.BaseURL != "http://localhost:8000/v1" || cfg.AI.Model != "LGAI-EXAONE/EXAONE-4.0-32B" {
		t.Fatalf("ai config = %#v", cfg.AI)
	}
	if cfg.AI.MaxTokens != 2048 || cfg.AI.Temperature != 0.3 {
		t.Fatalf("ai limits = %#v", cfg.AI)
	}
	if cfg.AI.APIToken != "secret-token" || cfg.AI.RateLimit != 12 {
		t.Fatalf("ai auth = %#v", cfg.AI)
	}
	if cfg.AI.Timeout != 45*time.Second || cfg.AI.MaxToolRounds != 4 {
		t.Fatalf("ai timing = %#v", cfg.AI)
	}
}

func TestLoadAIConfigDefaults(t *testing.T) {
	for _, key := range []string{
		"AI_PROVIDER", "AI_BASE_URL", "AI_MODEL", "AI_API_KEY", "AI_API_TOKEN",
		"AI_MAX_TOKENS", "AI_TEMPERATURE", "AI_TIMEOUT_SECONDS", "AI_MAX_TOOL_ROUNDS",
		"AI_RATE_LIMIT_PER_MINUTE",
	} {
		t.Setenv(key, "")
	}
	cfg := Load()
	if cfg.AI.Provider != "openai" {
		t.Fatalf("provider = %q", cfg.AI.Provider)
	}
	if cfg.AI.MaxTokens != 1024 || cfg.AI.Temperature != 0.2 {
		t.Fatalf("ai defaults = %#v", cfg.AI)
	}
	if cfg.AI.Timeout != 60*time.Second || cfg.AI.MaxToolRounds != 6 {
		t.Fatalf("ai timing defaults = %#v", cfg.AI)
	}
}

func TestLoadAIConfigClampsInvalidValues(t *testing.T) {
	t.Setenv("AI_MAX_TOKENS", "999999")
	t.Setenv("AI_TEMPERATURE", "5")
	t.Setenv("AI_TIMEOUT_SECONDS", "0")
	t.Setenv("AI_MAX_TOOL_ROUNDS", "-3")

	cfg := Load()
	if cfg.AI.MaxTokens != 8192 {
		t.Fatalf("max tokens = %d", cfg.AI.MaxTokens)
	}
	if cfg.AI.Temperature != 2 {
		t.Fatalf("temperature = %v", cfg.AI.Temperature)
	}
	if cfg.AI.Timeout != 60*time.Second {
		t.Fatalf("timeout = %s", cfg.AI.Timeout)
	}
	if cfg.AI.MaxToolRounds != 6 {
		t.Fatalf("rounds = %d", cfg.AI.MaxToolRounds)
	}
}
