import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from '../i18n';

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path (plain HTTP / older browsers).
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    area.remove();
  }
  return ok;
}

interface DataCellProps {
  text: string;
  copyText?: string;
  copyLabel?: string;
  mono?: boolean;
  clampLines?: number;
  className?: string;
}

export default function DataCell({
  text,
  copyText,
  copyLabel,
  mono = false,
  clampLines = 3,
  className,
}: DataCellProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  const lines = text.split('\n').length;
  const canExpand = text.length > 160 || lines > clampLines;

  const handleCopy = async () => {
    if (copyText == null) return;
    const ok = await writeClipboard(copyText);
    setCopied(ok);
    setCopyFailed(!ok);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 1600);
  };

  return (
    <div className={`data-cell${mono ? ' is-mono' : ''}${className ? ` ${className}` : ''}`}>
      <div
        className={`data-cell-text${!expanded && canExpand ? ' is-clamped' : ''}`}
        style={{ ['--clamp-lines' as string]: String(clampLines) } as CSSProperties}
      >
        {text}
      </div>
      {(canExpand || copyText != null) && (
        <div className="data-cell-actions">
          {canExpand && (
            <button
              type="button"
              className="data-cell-btn"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? t('dataViewer.collapse') : t('dataViewer.expand')}
            </button>
          )}
          {copyText != null && (
            <button
              type="button"
              className="data-cell-btn"
              onClick={() => void handleCopy()}
            >
              {copied
                ? t('dataViewer.copied')
                : copyFailed
                  ? t('dataViewer.copyFailed')
                  : copyLabel ?? t('common.copy')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
