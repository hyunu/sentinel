package api

import (
	"testing"

	"github.com/hyunu/sentinel/internal/models"
)

func TestAISettingsResponseMasksAPIKey(t *testing.T) {
	t.Parallel()
	h := &Handler{}
	settings := &models.AISettings{
		Provider: "openai",
		BaseURL:  "https://api.openai.com/v1",
		Model:    "gpt-4.1-mini",
		APIKey:   "secret-key",
	}

	response := h.aiSettingsResponse(settings)
	if response.APIKey != "" {
		t.Fatal("API key must not be returned")
	}
	if !response.HasAPIKey {
		t.Fatal("has_api_key must be true")
	}
	if response.Provider != settings.Provider || response.Model != settings.Model {
		t.Fatalf("unexpected response: %#v", response)
	}
}
