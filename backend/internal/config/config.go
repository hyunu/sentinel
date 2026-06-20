package config

import (
	"os"
	"time"
)

type Config struct {
	Server   ServerConfig
	MongoDB  MongoDBConfig
	Heartbeat HeartbeatConfig
}

type ServerConfig struct {
	Host            string
	Port            string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
}

type MongoDBConfig struct {
	URI      string
	Database string
}

type HeartbeatConfig struct {
	Timeout time.Duration
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
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
