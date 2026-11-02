package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hyunu/sentinel/internal/ai"
	"github.com/hyunu/sentinel/internal/models"
)

const defaultAITimeoutSeconds = 120

func (h *Handler) buildAgentFromSettings(settings *models.AISettings) (*ai.Agent, error) {
	providerCfg := ai.ProviderConfig{
		Provider: settings.Provider,
		BaseURL:  settings.BaseURL,
		APIKey:   settings.APIKey,
		Model:    settings.Model,
		Timeout:  time.Duration(settings.TimeoutSeconds) * time.Second,
	}
	if !providerCfg.Configured() {
		return nil, fmt.Errorf("model and API key/base URL are required")
	}
	provider, err := ai.NewProvider(providerCfg)
	if err != nil {
		return nil, err
	}
	temperature := settings.Temperature
	return ai.NewAgent(provider, ai.Options{
		MaxRounds:   settings.MaxToolRounds,
		MaxTokens:   settings.MaxTokens,
		Temperature: &temperature,
	}, h.logger), nil
}

func (h *Handler) aiSettingsResponse(settings *models.AISettings) *models.AISettings {
	if settings == nil {
		return &models.AISettings{
			Provider:       ai.ProviderOpenAI,
			MaxTokens:      1024,
			Temperature:    0.2,
			TimeoutSeconds: defaultAITimeoutSeconds,
			MaxToolRounds:  6,
		}
	}
	out := *settings
	out.HasAPIKey = strings.TrimSpace(settings.APIKey) != ""
	out.APIKey = ""
	return &out
}

// GetAISettings returns the persisted AI configuration without exposing the API key.
func (h *Handler) GetAISettings(c *gin.Context) {
	if !h.authorizeAI(c) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	settings, err := h.db.GetAISettings(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI settings"})
		return
	}
	if settings == nil {
		settings = &models.AISettings{
			Provider:       ai.ProviderOpenAI,
			MaxTokens:      1024,
			Temperature:    0.2,
			TimeoutSeconds: defaultAITimeoutSeconds,
			MaxToolRounds:  6,
		}
	}
	c.JSON(http.StatusOK, h.aiSettingsResponse(settings))
}

// UpdateAISettings validates and applies a provider config, then persists it.
func (h *Handler) UpdateAISettings(c *gin.Context) {
	if !h.authorizeAI(c) {
		return
	}
	var req struct {
		Provider       string  `json:"provider"`
		BaseURL        string  `json:"base_url"`
		Model          string  `json:"model"`
		APIKey         string  `json:"api_key"`
		ClearAPIKey    bool    `json:"clear_api_key"`
		MaxTokens      int     `json:"max_tokens"`
		Temperature    float64 `json:"temperature"`
		TimeoutSeconds int     `json:"timeout_seconds"`
		MaxToolRounds  int     `json:"max_tool_rounds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	existing, err := h.db.GetAISettings(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI settings"})
		return
	}

	provider := ai.NormalizeProviderName(req.Provider)
	if provider == "" {
		provider = ai.ProviderOpenAI
	}
	if provider != ai.ProviderOpenAI && provider != ai.ProviderAnthropic {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported AI provider"})
		return
	}

	baseURL := strings.TrimSpace(req.BaseURL)
	apiKey := strings.TrimSpace(req.APIKey)
	// Keep a stored key when the user re-saves the same provider endpoint.
	// When switching providers/endpoints, require the new key explicitly so an
	// OpenAI key is never accidentally sent to another provider.
	if !req.ClearAPIKey && apiKey == "" && existing != nil &&
		existing.Provider == provider &&
		strings.TrimRight(existing.BaseURL, "/") == strings.TrimRight(baseURL, "/") {
		apiKey = existing.APIKey
	}
	if req.ClearAPIKey {
		apiKey = ""
	}

	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1024
	}
	if maxTokens < 128 {
		maxTokens = 128
	}
	if maxTokens > 8192 {
		maxTokens = 8192
	}
	temperature := req.Temperature
	if temperature < 0 {
		temperature = 0
	}
	if temperature > 2 {
		temperature = 2
	}
	timeoutSeconds := req.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = defaultAITimeoutSeconds
	}
	if timeoutSeconds > 600 {
		timeoutSeconds = 600
	}
	maxRounds := req.MaxToolRounds
	if maxRounds <= 0 {
		maxRounds = 6
	}
	if maxRounds > 12 {
		maxRounds = 12
	}

	settings := &models.AISettings{
		ID:             "default",
		Provider:       provider,
		BaseURL:        baseURL,
		Model:          strings.TrimSpace(req.Model),
		APIKey:         apiKey,
		MaxTokens:      maxTokens,
		Temperature:    temperature,
		TimeoutSeconds: timeoutSeconds,
		MaxToolRounds:  maxRounds,
		UpdatedAt:      time.Now().UTC(),
	}

	if settings.Model != "" {
		agent, err := h.buildAgentFromSettings(settings)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid AI configuration: " + err.Error()})
			return
		}
		h.replaceAgent(agent)
	} else {
		h.replaceAgent(nil)
	}

	if err := h.db.SaveAISettings(ctx, settings); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save AI settings"})
		return
	}

	c.JSON(http.StatusOK, h.aiSettingsResponse(settings))
}
