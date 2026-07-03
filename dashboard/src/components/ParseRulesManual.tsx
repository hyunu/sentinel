import Modal from './Modal';
import type { ManualBlock, ManualLocale } from '../data/parseRulesManual';
import {
  MANUAL_EXPRESSIONS,
  MANUAL_GROUPS,
  MANUAL_INTRO,
  MANUAL_UI,
  MANUAL_WORKFLOW,
  t as manualT,
} from '../data/parseRulesManual';
import { useTranslation } from '../i18n';
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
            return <p key={i} className="manual-p">{manualT(block.text, locale)}</p>;
          case 'ul':
            return (
              <ul key={i} className="manual-ul">
                {block.items.map((item, j) => (
                  <li key={j}>{manualT(item, locale)}</li>
                ))}
              </ul>
            );
          case 'json':
            return (
              <div key={i} className="manual-code-wrap">
                {block.label && (
                  <span className="manual-code-label">{manualT(block.label, locale)}</span>
                )}
                <pre className="manual-code mono">{block.code}</pre>
              </div>
            );
          case 'hex':
            return (
              <div key={i} className="manual-code-wrap">
                {block.label && (
                  <span className="manual-code-label">{manualT(block.label, locale)}</span>
                )}
                <pre className="manual-hex mono">{block.code}</pre>
              </div>
            );
          case 'tip':
            return (
              <p key={i} className="manual-tip">
                <strong>{tipLabel}:</strong> {manualT(block.text, locale)}
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
  const { locale: appLocale } = useTranslation();
  const locale: ManualLocale = appLocale;

  return (
    <Modal open={open} onClose={onClose} title={manualT(MANUAL_UI.title, locale)} wide>
      <div className="parse-rules-manual">
        <details className="manual-section" open>
          <summary>{manualT(MANUAL_UI.gettingStarted, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={MANUAL_INTRO} locale={locale} tipLabel={manualT(MANUAL_UI.tipLabel, locale)} />
          </div>
        </details>

        <details className="manual-section">
          <summary>{manualT(MANUAL_UI.expressions, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={MANUAL_EXPRESSIONS} locale={locale} tipLabel={manualT(MANUAL_UI.tipLabel, locale)} />
          </div>
        </details>

        {MANUAL_GROUPS.map(group => (
          <details key={group.id} className="manual-section manual-section--group">
            <summary>{manualT(group.title, locale)}</summary>
            <div className="manual-section-body">
              <ManualBlocks blocks={group.intro} locale={locale} tipLabel={manualT(MANUAL_UI.tipLabel, locale)} />
              <div className="manual-type-list">
                {group.types.map(typeDoc => (
                  <details key={typeDoc.type} className="manual-type">
                    <summary>
                      <code className="manual-type-name">{typeDoc.type}</code>
                      <span className="manual-type-summary">{manualT(typeDoc.summary, locale)}</span>
                    </summary>
                    <div className="manual-type-body">
                      <ManualBlocks blocks={typeDoc.blocks} locale={locale} tipLabel={manualT(MANUAL_UI.tipLabel, locale)} />
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </details>
        ))}

        <details className="manual-section">
          <summary>{manualT(MANUAL_UI.workflow, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={MANUAL_WORKFLOW} locale={locale} tipLabel={manualT(MANUAL_UI.tipLabel, locale)} />
          </div>
        </details>

        <p className="manual-footnote muted">{manualT(MANUAL_UI.footnote, locale)}</p>
      </div>
    </Modal>
  );
}
