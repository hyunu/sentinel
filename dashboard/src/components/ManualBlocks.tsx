import type { ManualBlock, ManualLocale } from '../data/parseRulesManual';
import { t as manualT } from '../data/parseRulesManual';

type ManualBlocksProps = {
  blocks: ManualBlock[];
  locale: ManualLocale;
  tipLabel: string;
};

export default function ManualBlocks({ blocks, locale, tipLabel }: ManualBlocksProps) {
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
