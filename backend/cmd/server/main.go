package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hyunu/sentinel/internal/ai"
	"github.com/hyunu/sentinel/internal/api"
	"github.com/hyunu/sentinel/internal/config"
	"github.com/hyunu/sentinel/internal/db"
	"github.com/hyunu/sentinel/internal/models"
	"go.uber.org/zap"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	cfg := config.Load()

	database, err := db.New(&cfg.MongoDB, logger)
	if err != nil {
		logger.Fatal("Failed to connect to MongoDB", zap.Error(err))
	}
	defer database.Close(context.Background())

	if err := database.EnsureIndexes(context.Background()); err != nil {
		logger.Warn("Failed to ensure indexes", zap.Error(err))
	}

	if err := database.EnsureProtocols(context.Background()); err != nil {
		logger.Warn("Failed to seed protocols", zap.Error(err))
	}

	if err := database.EnsureSchemaPresets(context.Background()); err != nil {
		logger.Warn("Failed to seed schema presets", zap.Error(err))
	}

	if err := database.BackfillTemperatureUart(context.Background()); err != nil {
		logger.Warn("Failed to backfill temperature uart data", zap.Error(err))
	}

	aiSettings, err := database.GetAISettings(context.Background())
	if err != nil {
		logger.Warn("Failed to load AI settings", zap.Error(err))
	}
	if aiSettings == nil {
		aiSettings = aiSettingsFromConfig(cfg.AI)
		if err := database.SaveAISettings(context.Background(), aiSettings); err != nil {
			logger.Warn("Failed to seed AI settings", zap.Error(err))
		}
	}

	router := api.SetupRouter(database, logger, buildAIAgent(aiSettings, logger), api.HandlerOptions{
		AIToken:   cfg.AI.APIToken,
		RateLimit: cfg.AI.RateLimit,
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	go func() {
		logger.Info("Starting server", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Server failed", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("Server forced to shutdown", zap.Error(err))
	}

	logger.Info("Server exited")
}

func aiSettingsFromConfig(cfg config.AIConfig) *models.AISettings {
	return &models.AISettings{
		ID:             "default",
		Provider:       cfg.Provider,
		BaseURL:        cfg.BaseURL,
		Model:          cfg.Model,
		APIKey:         cfg.APIKey,
		MaxTokens:      cfg.MaxTokens,
		Temperature:    cfg.Temperature,
		TimeoutSeconds: int(cfg.Timeout.Seconds()),
		MaxToolRounds:  cfg.MaxToolRounds,
		UpdatedAt:      time.Now().UTC(),
	}
}

func buildAIAgent(settings *models.AISettings, logger *zap.Logger) *ai.Agent {
	if settings == nil {
		return nil
	}
	timeoutSeconds := settings.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = 60
	}
	maxTokens := settings.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1024
	}
	maxRounds := settings.MaxToolRounds
	if maxRounds <= 0 {
		maxRounds = 6
	}
	providerCfg := ai.ProviderConfig{
		Provider: settings.Provider,
		BaseURL:  settings.BaseURL,
		APIKey:   settings.APIKey,
		Model:    settings.Model,
		Timeout:  time.Duration(timeoutSeconds) * time.Second,
	}
	if !providerCfg.Configured() {
		logger.Info("AI is not configured; /api/v1/ai/query will return 503")
		return nil
	}
	provider, err := ai.NewProvider(providerCfg)
	if err != nil {
		logger.Warn("AI provider configuration is invalid; AI is disabled", zap.Error(err))
		return nil
	}
	temp := settings.Temperature
	agent := ai.NewAgent(provider, ai.Options{
		MaxRounds:   maxRounds,
		MaxTokens:   maxTokens,
		Temperature: &temp,
	}, logger)
	logger.Info("AI configured",
		zap.String("provider", agent.ProviderName()),
		zap.String("model", agent.Model()),
		zap.Int("max_tool_rounds", agent.MaxRounds()),
	)
	return agent
}
