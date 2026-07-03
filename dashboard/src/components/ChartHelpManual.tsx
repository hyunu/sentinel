import Modal from './Modal';
import ManualBlocks from './ManualBlocks';
import {
  CHART_MANUAL_INTERACTIONS,
  CHART_MANUAL_LIVE,
  CHART_MANUAL_MINIMAP,
  CHART_MANUAL_OVERVIEW,
  CHART_MANUAL_TOOLBAR,
  CHART_MANUAL_UI,
} from '../data/chartManual';
import { t as manualT } from '../data/parseRulesManual';
import type { ManualLocale } from '../data/parseRulesManual';
import { useTranslation } from '../i18n';
import '../styles/parseRulesManual.css';

type ChartHelpManualProps = {
  open: boolean;
  onClose: () => void;
};

export default function ChartHelpManual({ open, onClose }: ChartHelpManualProps) {
  const { locale: appLocale } = useTranslation();
  const locale: ManualLocale = appLocale;
  const tipLabel = manualT(CHART_MANUAL_UI.tipLabel, locale);

  return (
    <Modal open={open} onClose={onClose} title={manualT(CHART_MANUAL_UI.title, locale)} wide>
      <div className="parse-rules-manual">
        <details className="manual-section" open>
          <summary>{manualT(CHART_MANUAL_UI.overview, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={CHART_MANUAL_OVERVIEW} locale={locale} tipLabel={tipLabel} />
          </div>
        </details>

        <details className="manual-section" open>
          <summary>{manualT(CHART_MANUAL_UI.interactions, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={CHART_MANUAL_INTERACTIONS} locale={locale} tipLabel={tipLabel} />
          </div>
        </details>

        <details className="manual-section">
          <summary>{manualT(CHART_MANUAL_UI.minimap, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={CHART_MANUAL_MINIMAP} locale={locale} tipLabel={tipLabel} />
          </div>
        </details>

        <details className="manual-section">
          <summary>{manualT(CHART_MANUAL_UI.liveMode, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={CHART_MANUAL_LIVE} locale={locale} tipLabel={tipLabel} />
          </div>
        </details>

        <details className="manual-section">
          <summary>{manualT(CHART_MANUAL_UI.toolbar, locale)}</summary>
          <div className="manual-section-body">
            <ManualBlocks blocks={CHART_MANUAL_TOOLBAR} locale={locale} tipLabel={tipLabel} />
          </div>
        </details>

        <p className="manual-footnote muted">{manualT(CHART_MANUAL_UI.footnote, locale)}</p>
      </div>
    </Modal>
  );
}
