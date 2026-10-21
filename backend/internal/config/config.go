package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Server    ServerConfig
	MongoDB   MongoDBConfig
	Heartbeat HeartbeatConfig
	AI        AIConfig
}

type ServerConfig struct {
	Host         string
	Port         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

type MongoDBConfig struct {
	URI      string
	Database string
}

type HeartbeatConfig struct {
	Timeout time.Duration
}

type AIConfig struct {
	Provider      string
	BaseURL       string
	APIKey        string
	Model         string
	APIToken      string
	MaxTokens     int
	Temperature   float64
	Timeout       time.Duration
	MaxToolRounds int
	RateLimit     int
}

func Load() *Config {
	return &Config{
		Server: ServerConfig{
			Host:         getEnv("SERVER_HOST", "0.0.0.0"),
			Port:         getEnv("SERVER_PORT", "5050"),
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 30 * time.Second,
		},
		MongoDB: MongoDBConfig{
			URI:      getEnv("MONGODB_URI", "mongodb://localhost:27017"),
			Database: getEnv("MONGODB_DATABASE", "sentinel"),
		},
		Heartbeat: HeartbeatConfig{
			Timeout: 90 * time.Second,
		},
		AI: AIConfig{
			Provider:      getEnv("AI_PROVIDER", "openai"),
			BaseURL:       getEnv("AI_BASE_URL", ""),
			APIKey:        getEnv("AI_API_KEY", ""),
			Model:         getEnv("AI_MODEL", ""),
			APIToken:      getEnv("AI_API_TOKEN", ""),
			MaxTokens:     clampInt(getEnvInt("AI_MAX_TOKENS", 1024), 128, 8192),
			Temperature:   clampFloat(getEnvFloat("AI_TEMPERATURE", 0.2), 0, 2),
			Timeout:       time.Duration(clampInt(getEnvInt("AI_TIMEOUT_SECONDS", 60), 5, 600)) * time.Second,
			MaxToolRounds: clampInt(getEnvInt("AI_MAX_TOOL_ROUNDS", 6), 1, 12),
			RateLimit:     clampInt(getEnvInt("AI_RATE_LIMIT_PER_MINUTE", 30), 1, 600),
		},
	}
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func clampFloat(value, min, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func getEnvInt(key string, fallback int) int {
	raw := getEnv(key, "")
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func getEnvFloat(key string, fallback float64) float64 {
	raw := getEnv(key, "")
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return fallback
	}
	return value
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
