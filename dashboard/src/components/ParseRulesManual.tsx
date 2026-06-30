import { useState } from 'react';
import Modal from './Modal';
import type { ManualBlock, ManualLocale } from '../data/parseRulesManual';
import {
  MANUAL_EXPRESSIONS,
  MANUAL_GROUPS,
  MANUAL_INTRO,
  MANUAL_UI,
  MANUAL_WORKFLOW,
  t,
} from '../data/parseRulesManual';
import '../styles/parseRulesManual.css';

type ParseRulesManualProps = {
  open: boolean;
  onClose: () => void;
};

function ManualBlocks({
  blocks,
  locale,
  tipLabel,
}: {
  blocks: ManualBlock[];
  locale: ManualLocale;
  tipLabel: string;
}) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'p':
            return <p key={i} className="manual-p">{t(block.text, locale)}</p>;
          case 'ul':
            return (
              <ul key={i} className="manual-ul">
                {block.items.map((item, j) => (
                  <li key={j}>{t(item, locale)}</li>
                ))}
              </ul>
            );
          case 'json':
            return (
              <div key={i} className="manual-code-wrap">
                {block.label && (
                  <span className="manual-code-label">{t(block.label, locale)}</span>
                )}
                <pre className="manual-code mono">{block.code}</pre>
              </div>
            );
          case 'hex':
            return (
              <div key={i} className="manual-code-wrap">
                {block.label && (
                  <span className="manual-code-label">{t(block.label, locale)}</span>
                )}
                <pre className="manual-hex mono">{block.code}</pre>
              </div>
            );
          case 'tip':
            return (
              <p key={i} className="manual-tip">
                <strong>{tipLabel}:</strong> {t(block.text, locale)}
              </p>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

export default function ParseRulesManual({ open, onClose }: ParseRulesManualProps) {
  const [locale, setLocale] = useState<ManualLocale>('ko');

  return (
    <Modal open={open} onClose={onClose} title={t(MANUAL_UI.title, locale)} wide>
      <div className="parse-rules-manual">
        <div className="manual-lang-bar">
          <div className="segmented-control manual-lang-toggle">
            <button
              type="button"
              className={locale === 'ko' ? 'is-active' : ''}
              onClick={() => setLocale('ko')}
            >
              한국어
            </button>
            <button
              type="button"
              className={locale === 'en' ? 'is-active' : ''}
              onClick={() => setLocale('en')}
            >
              English
            </button>
          </div>
        </div>

        <details className="manual-section" open>
          <summary>{t(MANUAL_UI.gettingStarted, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={MANUAL_INTRO} locale={locale} tipLabel={t(MANUAL_UI.tipLabel, locale)} />
          </div>
        </details>

        <details className="manual-section">
          <summary>{t(MANUAL_UI.expressions, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={MANUAL_EXPRESSIONS} locale={locale} tipLabel={t(MANUAL_UI.tipLabel, locale)} />
          </div>
        </details>

        {MANUAL_GROUPS.map(group => (
          <details key={group.id} className="manual-section manual-section--group">
            <summary>{t(group.title, locale)}</summary>
            <div className="manual-section-body">
              <ManualBlocks blocks={group.intro} locale={locale} tipLabel={t(MANUAL_UI.tipLabel, locale)} />
              <div className="manual-type-list">
                {group.types.map(typeDoc => (
                  <details key={typeDoc.type} className="manual-type">
                    <summary>
                      <code className="manual-type-name">{typeDoc.type}</code>
                      <span className="manual-type-summary">{t(typeDoc.summary, locale)}</span>
                    </summary>
                    <div className="manual-type-body">
                      <ManualBlocks blocks={typeDoc.blocks} locale={locale} tipLabel={t(MANUAL_UI.tipLabel, locale)} />
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </details>
        ))}

        <details className="manual-section">
          <summary>{t(MANUAL_UI.workflow, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={MANUAL_WORKFLOW} locale={locale} tipLabel={t(MANUAL_UI.tipLabel, locale)} />
          </div>
        </details>

        <p className="manual-footnote muted">{t(MANUAL_UI.footnote, locale)}</p>
      </div>
    </Modal>
  );
}
