import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SchemaPreset } from '../api';
import { protocolFieldCount, protocolFormatLabel } from '../lib/protocolFormat';
import { useTranslation } from '../i18n';

export default function SchemaPresetsPanel() {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<SchemaPreset[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPresets(await api.schemaPresets.list());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload().catch(console.error); }, [reload]);

  const remove = async (preset: SchemaPreset) => {
    if (!window.confirm(t('templates.deleteConfirm', { name: preset.name }))) return;
    await api.schemaPresets.delete(preset.id);
    await reload();
  };

  const seedDefaults = async () => {
    await api.schemaPresets.seedDefault();
    await reload();
  };

  return (
    <div className="card table-card schema-presets-panel">
      <div className="card-header">
        <h2>{t('templates.saved')}</h2>
        <div className="btn-group">
          <button type="button" className="btn-sm" onClick={seedDefaults}>{t('templates.seedDefaults')}</button>
          <Link to="/protocols/templates/new" className="btn-primary btn-sm protocols-add-link">+ {t('templates.new')}</Link>
        </div>
      </div>

      {loading ? (
        <p className="muted preset-list-empty">{t('common.loading')}</p>
      ) : presets.length === 0 ? (
        <div className="preset-list-empty">
          <p className="muted">{t('templates.empty')}</p>
          <Link to="/protocols/templates/new" className="btn-primary btn-sm">{t('templates.createFirst')}</Link>
        </div>
      ) : (
        <div className="preset-list">
          {presets.map(p => (
            <div key={p.id} className="preset-list-row">
              <div className="preset-list-main">
                <div className="preset-list-title">
                  {p.name}
                  {p.protocol_version && <span className="tag">v{p.protocol_version}</span>}
                </div>
                {p.description && <p className="muted preset-list-desc">{p.description}</p>}
                <div className="preset-list-tags">
                  {!p.parse_rules?.fields?.length ? (
                    <span className="tag tag-warning">{t('templates.noParseRules')}</span>
                  ) : (
                    <>
                      <span className="tag tag-subtle">{protocolFormatLabel({ parse_rules: p.parse_rules })}</span>
                      <span className="tag tag-subtle">{t('protocols.topLevelFields', { count: protocolFieldCount({ parse_rules: p.parse_rules }) })}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="btn-group">
                <Link to={`/protocols/templates/${p.id}/edit`} className="btn-sm">{t('common.edit')}</Link>
                <button type="button" className="btn-danger btn-sm" onClick={() => remove(p)}>{t('common.delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
