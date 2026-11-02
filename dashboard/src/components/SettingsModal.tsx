import { useCallback, useEffect, useState } from 'react';
import Modal from './Modal';
import { api, type AISettings, type AIStatus } from '../api';
import { useTranslation, type Locale } from '../i18n';
import { useTheme, type Theme } from '../theme';

const AI_TOKEN_STORAGE_KEY = 'sentinel-ai-token';

function readStoredAIToken(): string {
  try {
    return localStorage.getItem(AI_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

const LOCALES: Array<{ id: Locale; labelKey: 'settings.localeEn' | 'settings.localeKo' }> = [
  { id: 'en', labelKey: 'settings.localeEn' },
  { id: 'ko', labelKey: 'settings.localeKo' },
];

const THEMES: Array<{ id: Theme; labelKey: 'settings.themeDark' | 'settings.themeLight' }> = [
  { id: 'dark', labelKey: 'settings.themeDark' },
  { id: 'light', labelKey: 'settings.themeLight' },
];

type AIForm = {
  provider: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutSeconds: number;
  maxToolRounds: number;
};

const AI_PRESETS = [
  {
    id: 'exaone-lmstudio',
    label: 'EXAONE (LM Studio)',
    provider: 'openai',
    baseUrl: 'http://100.118.170.68:8000/v1',
    model: 'exaone-3.5-7.8b-instruct',
  },
  {
    id: 'exaone-commercial',
    label: 'EXAONE (Commercial API)',
    provider: 'openai',
    baseUrl: 'https://api.friendli.ai/serverless/v1',
    model: 'LGAI-EXAONE/EXAONE-4.0-32B',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    provider: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash',
  },
  {
    id: 'groq-free',
    label: 'Groq Free (GPT-OSS 120B)',
    provider: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
  },
  {
    id: 'openrouter-free',
    label: 'OpenRouter Free (Nemotron)',
    provider: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  },
  {
    id: 'mistral-free',
    label: 'Mistral Free',
    provider: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
  },
  {
    id: 'custom',
    label: 'Custom / OpenAI-compatible',
    provider: 'openai',
    baseUrl: '',
    model: '',
  },
] as const;

function formFromSettings(settings: AISettings): AIForm {
  return {
    provider: settings.provider || 'openai',
    baseUrl: settings.base_url || '',
    model: settings.model || '',
    maxTokens: settings.max_tokens || 1024,
    temperature: Number.isFinite(settings.temperature) ? settings.temperature : 0.2,
    timeoutSeconds: settings.timeout_seconds || 120,
    maxToolRounds: settings.max_tool_rounds || 6,
  };
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [aiToken, setAiToken] = useState(readStoredAIToken);
  const [aiForm, setAIForm] = useState<AIForm>({
    provider: 'openai',
    baseUrl: '',
    model: '',
    maxTokens: 1024,
    temperature: 0.2,
    timeoutSeconds: 120,
    maxToolRounds: 6,
  });
  const [aiApiKey, setAIApiKey] = useState('');
  const [aiHasStoredKey, setAIHasStoredKey] = useState(false);
  const [aiStatus, setAIStatus] = useState<AIStatus | null>(null);
  const [aiLoading, setAILoading] = useState(false);
  const [aiSaving, setAISaving] = useState(false);
  const [aiError, setAIError] = useState('');
  const [aiSaved, setAISaved] = useState('');
  const [presetID, setPresetID] = useState('exaone-lmstudio');

  const saveAiToken = (value: string) => {
    setAiToken(value);
    try {
      const trimmed = value.trim();
      if (trimmed) localStorage.setItem(AI_TOKEN_STORAGE_KEY, trimmed);
      else localStorage.removeItem(AI_TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- load server settings on modal open */
  useEffect(() => {
    if (!open) return;
    setAIError('');
    setAISaved('');
    setAILoading(true);
    let cancelled = false;
    Promise.all([
      api.ai.getSettings(),
      api.ai.status().catch(() => null),
    ]).then(([settings, status]) => {
      if (cancelled) return;
      setAIForm(formFromSettings(settings));
      setAIHasStoredKey(settings.has_api_key);
      setAIApiKey('');
      setAIStatus(status);
      const matching = AI_PRESETS.find(preset => (
        preset.provider === settings.provider
        && preset.baseUrl === settings.base_url
        && preset.model === settings.model
      ));
      setPresetID(matching?.id ?? 'custom');
    }).catch(error => {
      if (!cancelled) setAIError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setAILoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateAIForm = useCallback((patch: Partial<AIForm>) => {
    setAIForm(prev => ({ ...prev, ...patch }));
    setAISaved('');
  }, []);

  const selectPreset = useCallback((id: string) => {
    const preset = AI_PRESETS.find(item => item.id === id);
    setPresetID(id);
    if (!preset || preset.id === 'custom') return;
    updateAIForm({
      provider: preset.provider,
      baseUrl: preset.baseUrl,
      model: preset.model,
    });
  }, [updateAIForm]);

  const saveAI = useCallback(async () => {
    setAISaving(true);
    setAIError('');
    setAISaved('');
    try {
      const settings = await api.ai.saveSettings({
        provider: aiForm.provider,
        base_url: aiForm.baseUrl.trim(),
        model: aiForm.model.trim(),
        api_key: aiApiKey.trim(),
        max_tokens: aiForm.maxTokens,
        temperature: aiForm.temperature,
        timeout_seconds: aiForm.timeoutSeconds,
        max_tool_rounds: aiForm.maxToolRounds,
      });
      setAIHasStoredKey(settings.has_api_key);
      setAIApiKey('');
      setAISaved(t('settings.aiSaved'));
      api.ai.status().then(setAIStatus).catch(() => setAIStatus(null));
    } catch (error) {
      setAIError(error instanceof Error ? error.message : String(error));
    } finally {
      setAISaving(false);
    }
  }, [aiApiKey, aiForm, t]);

  return (
    <Modal open={open} onClose={onClose} title={t('settings.title')} wide>
      <div className="settings-section">
        <h3 className="settings-section-title">{t('settings.language')}</h3>
        <p className="muted settings-section-desc">{t('settings.languageDesc')}</p>
        <div className="settings-option-group" role="group" aria-label={t('settings.language')}>
          {LOCALES.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              className={`settings-option-btn${locale === id ? ' is-active' : ''}`}
              onClick={() => setLocale(id)}
              aria-pressed={locale === id}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">{t('settings.theme')}</h3>
        <p className="muted settings-section-desc">{t('settings.themeDesc')}</p>
        <div className="settings-option-group" role="group" aria-label={t('settings.theme')}>
          {THEMES.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              className={`settings-option-btn${theme === id ? ' is-active' : ''}`}
              onClick={() => setTheme(id)}
              aria-pressed={theme === id}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-ai-heading">
          <div>
            <h3 className="settings-section-title">{t('settings.aiProvider')}</h3>
            <p className="muted settings-section-desc">{t('settings.aiProviderDesc')}</p>
          </div>
          <span className={`ai-status-pill${aiStatus?.configured ? '' : ' is-off'}`}>
            {aiStatus?.configured
              ? `${aiStatus.provider} · ${aiStatus.model}`
              : t('settings.aiNotConfigured')}
          </span>
        </div>

        <div className="settings-ai-form">
          <label className="settings-field">
            <span>{t('settings.aiPreset')}</span>
            <select value={presetID} onChange={event => selectPreset(event.target.value)} disabled={aiLoading || aiSaving}>
              {AI_PRESETS.map(preset => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </select>
          </label>

          <div className="settings-ai-grid">
            <label className="settings-field">
              <span>{t('settings.aiProtocol')}</span>
              <select
                value={aiForm.provider}
                onChange={event => updateAIForm({ provider: event.target.value })}
                disabled={aiLoading || aiSaving}
              >
                <option value="openai">OpenAI compatible</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </label>
            <label className="settings-field">
              <span>{t('settings.aiModel')}</span>
              <input
                value={aiForm.model}
                onChange={event => updateAIForm({ model: event.target.value })}
                placeholder="gpt-4.1-mini / exaone-3.5-7.8b-instruct"
                disabled={aiLoading || aiSaving}
              />
            </label>
          </div>

          <label className="settings-field">
            <span>{t('settings.aiBaseUrl')}</span>
            <input
              value={aiForm.baseUrl}
              onChange={event => updateAIForm({ baseUrl: event.target.value })}
              placeholder="https://api.openai.com/v1"
              disabled={aiLoading || aiSaving}
            />
          </label>

          <label className="settings-field">
            <span>{t('settings.aiApiKey')}</span>
            <input
              type="password"
              value={aiApiKey}
              onChange={event => setAIApiKey(event.target.value)}
              placeholder={aiHasStoredKey ? t('settings.aiApiKeyStored') : t('settings.aiApiKeyPlaceholder')}
              autoComplete="off"
              disabled={aiLoading || aiSaving}
            />
            <small className="muted">{t('settings.aiApiKeyHint')}</small>
          </label>

          <div className="settings-ai-grid settings-ai-grid--three">
            <label className="settings-field">
              <span>{t('settings.aiMaxTokens')}</span>
              <input
                type="number"
                min={128}
                max={8192}
                value={aiForm.maxTokens}
                onChange={event => updateAIForm({ maxTokens: Number(event.target.value) })}
                disabled={aiLoading || aiSaving}
              />
            </label>
            <label className="settings-field">
              <span>{t('settings.aiTemperature')}</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={aiForm.temperature}
                onChange={event => updateAIForm({ temperature: Number(event.target.value) })}
                disabled={aiLoading || aiSaving}
              />
            </label>
            <label className="settings-field">
              <span>{t('settings.aiMaxRounds')}</span>
              <input
                type="number"
                min={1}
                max={12}
                value={aiForm.maxToolRounds}
                onChange={event => updateAIForm({ maxToolRounds: Number(event.target.value) })}
                disabled={aiLoading || aiSaving}
              />
            </label>
          </div>

          <label className="settings-field settings-field--narrow">
            <span>{t('settings.aiTimeout')}</span>
            <input
              type="number"
              min={5}
              max={600}
              value={aiForm.timeoutSeconds}
              onChange={event => updateAIForm({ timeoutSeconds: Number(event.target.value) })}
              disabled={aiLoading || aiSaving}
            />
          </label>

          {aiError && <p className="settings-ai-message is-error" role="alert">{aiError}</p>}
          {aiSaved && <p className="settings-ai-message is-success" role="status">{aiSaved}</p>}

          <div className="settings-ai-actions">
            <span className="muted settings-ai-note">{t('settings.aiPersistNote')}</span>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => void saveAI()}
              disabled={aiLoading || aiSaving || !aiForm.model.trim()}
            >
              {aiSaving ? t('common.saving') : t('settings.aiSave')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">{t('settings.aiToken')}</h3>
        <p className="muted settings-section-desc">{t('settings.aiTokenDesc')}</p>
        <input
          type="password"
          value={aiToken}
          placeholder={t('settings.aiTokenPlaceholder')}
          onChange={e => saveAiToken(e.target.value)}
          autoComplete="off"
        />
        <p className="muted settings-section-desc">{t('settings.aiTokenHint')}</p>
      </div>
    </Modal>
  );
}
