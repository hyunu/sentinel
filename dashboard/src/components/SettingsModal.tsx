import Modal from './Modal';
import { useTranslation, type Locale } from '../i18n';

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

const LOCALES: Array<{ id: Locale; labelKey: 'settings.localeEn' | 'settings.localeKo' }> = [
  { id: 'en', labelKey: 'settings.localeEn' },
  { id: 'ko', labelKey: 'settings.localeKo' },
];

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, locale, setLocale } = useTranslation();

  return (
    <Modal open={open} onClose={onClose} title={t('settings.title')}>
      <div className="settings-section">
        <h3 className="settings-section-title">{t('settings.language')}</h3>
        <p className="muted settings-section-desc">{t('settings.languageDesc')}</p>
        <div className="settings-language-options" role="group" aria-label={t('settings.language')}>
          {LOCALES.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              className={`settings-language-btn${locale === id ? ' is-active' : ''}`}
              onClick={() => setLocale(id)}
              aria-pressed={locale === id}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
