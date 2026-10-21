import { useState } from 'react';
import Modal from './Modal';
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

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [aiToken, setAiToken] = useState(readStoredAIToken);

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

  return (
    <Modal open={open} onClose={onClose} title={t('settings.title')}>
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
