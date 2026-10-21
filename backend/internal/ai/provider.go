package ai

import (
	"fmt"
	"strings"
)

const (
	ProviderOpenAI    = "openai"
	ProviderAnthropic = "anthropic"

	defaultOpenAIBaseURL = "https://api.openai.com/v1"
)

// NormalizeProviderName maps common aliases to the two supported wire protocols.
func NormalizeProviderName(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "openai", "openai-compatible", "openai_compatible", "compatible", "vllm", "ollama", "exaone":
		return ProviderOpenAI
	case "anthropic", "claude":
		return ProviderAnthropic
	default:
		return strings.ToLower(strings.TrimSpace(name))
	}
}

// Configured reports whether enough configuration exists to attempt a request.
func (c ProviderConfig) Configured() bool {
	if strings.TrimSpace(c.Model) == "" {
		return false
	}
	switch NormalizeProviderName(c.Provider) {
	case ProviderOpenAI:
		if strings.TrimSpace(c.APIKey) != "" {
			return true
		}
		base := strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
		return base != "" && base != defaultOpenAIBaseURL
	case ProviderAnthropic:
		return strings.TrimSpace(c.APIKey) != ""
	default:
		return false
	}
}

// NewProvider builds the provider selected by cfg.Provider.
func NewProvider(cfg ProviderConfig) (Provider, error) {
	if strings.TrimSpace(cfg.Model) == "" {
		return nil, fmt.Errorf("ai model is not configured")
	}
	switch NormalizeProviderName(cfg.Provider) {
	case ProviderOpenAI:
		return newOpenAIProvider(cfg)
	case ProviderAnthropic:
		return newAnthropicProvider(cfg)
	default:
		return nil, fmt.Errorf("unsupported ai provider %q", cfg.Provider)
	}
}
