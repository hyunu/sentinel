import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { JsonRuleDocument, ParseResult, SchemaPreset } from '../api';
import PageHeader from '../components/PageHeader';
import ParseRulesBuilder from '../components/ParseRulesBuilder';
import ParseRulesManual from '../components/ParseRulesManual';
import { useTranslation } from '../i18n';
import { DEFAULT_LCP_PARSE_RULES } from '../lib/protocolFormat';
import { blankParseRules, documentToJson, normalizeParseRulesDocument } from '../lib/ruleBuilderUtils';

function normalizeParseRules(raw?: JsonRuleDocument | null): JsonRuleDocument {
  return structuredClone(normalizeParseRulesDocument(raw));
}

function isParseError(result: ParseResult | { error: string }): result is { error: string } {
  return 'error' in result && typeof result.error === 'string';
}

export default function ProtocolEditPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const [loading, setLoading] = useState(!isNew);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0');
  const [description, setDescription] = useState('');
  const [rulesText, setRulesText] = useState(JSON.stringify(blankParseRules(), null, 2));
  const [rules, setRules] = useState<JsonRuleDocument>(() => blankParseRules());
  const [rulesError, setRulesError] = useState('');
  const [legacyNoRules, setLegacyNoRules] = useState(false);
  const [testHex, setTestHex] = useState('');
  const [testResult, setTestResult] = useState<ParseResult | { error: string } | null>(null);
  const [presets, setPresets] = useState<SchemaPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState<'ui' | 'json'>('ui');
  const [manualOpen, setManualOpen] = useState(false);

  const applyRules = useCallback((doc: JsonRuleDocument) => {
    if (!doc.fields?.length) {
      setRulesError(t('protocols.fieldRequired'));
      return;
    }
    setRules(doc);
    setRulesText(documentToJson(doc));
    setRulesError('');
    setLegacyNoRules(false);
  }, []);

  useEffect(() => {
    api.schemaPresets.list().then(setPresets).catch(console.error);
  }, []);

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    api.protocols.get(id)
      .then(p => {
        setName(p.name);
        setVersion(p.version);
        setDescription(p.description || '');
        const hasRules = Boolean(p.parse_rules?.fields?.length);
        setLegacyNoRules(!hasRules);
        applyRules(normalizeParseRules(p.parse_rules));
      })
      .catch(() => navigate('/protocols'))
      .finally(() => setLoading(false));
  }, [id, isNew, navigate, applyRules]);

  const onRulesChange = (text: string) => {
    setRulesText(text);
    try {
      applyRules(JSON.parse(text) as JsonRuleDocument);
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : t('protocols.invalidJson'));
    }
  };

  const runParseTest = useCallback(async () => {
    const hex = testHex.replace(/\s/g, '');
    if (!hex || rulesError) {
      setTestResult(null);
      return;
    }
    try {
      const result = await api.protocols.parse({ raw_hex: hex, parse_rules: rules });
      setTestResult(result);
    } catch (e) {
      setTestResult({ error: e instanceof Error ? e.message : t('protocols.parseFailed') });
    }
  }, [testHex, rules, rulesError]);

  useEffect(() => {
    const t = setTimeout(runParseTest, 300);
    return () => clearTimeout(t);
  }, [runParseTest]);

  const save = async () => {
    if (!name || saving || rulesError) return;
    setSaving(true);
    try {
      const body = { name, version, description, parse_rules: rules };
      if (isNew) await api.protocols.create(body);
      else if (id) await api.protocols.update(id, body);
      navigate('/protocols');
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (presetId: string) => {
    if (presetId === 'lcp') {
      applyRules(structuredClone(DEFAULT_LCP_PARSE_RULES));
      return;
    }
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    setName(preset.name);
    setVersion(preset.protocol_version || '1.0');
    setDescription(preset.description || '');
    applyRules(normalizeParseRules(preset.parse_rules));
  };

  if (loading) {
    return (
      <div className="page protocol-edit-page">
        <p className="muted">{t('protocols.loading')}</p>
      </div>
    );
  }

  const parseOk = testResult && !isParseError(testResult) && testResult.valid;
  const parseCrcFail = testResult && !isParseError(testResult) && !testResult.valid;
  const parseFail = testResult && (isParseError(testResult) || parseCrcFail);

  return (
    <div className="page protocol-edit-page">
      <div className="page-breadcrumb">
        <Link to="/protocols" className="page-back-link">{t('protocols.backLink')}</Link>
      </div>

      <div className="protocol-edit-toolbar">
        <PageHeader
          title={isNew ? t('protocols.newTitle') : t('protocols.editTitle')}
          subtitle={t('protocols.editSubtitle')}
        />
        <div className="protocol-edit-toolbar-actions">
          <button type="button" className="btn-ghost" onClick={() => setManualOpen(true)}>
            {t('common.manual')}
          </button>
          <Link to="/protocols" className="btn-ghost">{t('common.cancel')}</Link>
          <button
            type="button"
            className="btn-primary"
            disabled={!name || !!rulesError || saving}
            onClick={save}
          >
            {saving ? t('common.saving') : isNew ? t('common.create') : t('common.save')}
          </button>
        </div>
      </div>

      <ParseRulesManual open={manualOpen} onClose={() => setManualOpen(false)} />

      <div className="protocol-edit-stack">
        <div className="card protocol-info-card">
          <div className="card-header">
            <h2>{t('common.general')}</h2>
          </div>
          <div className="protocol-info-grid">
            <div className="form-field">
              <label>{t('common.name')}</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="LCP Protocol" />
            </div>
            <div className="form-field">
              <label>{t('common.version')}</label>
              <input value={version} onChange={e => setVersion(e.target.value)} />
            </div>
            <div className="form-field">
              <label>{t('common.description')}</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder={t('common.optional')} />
            </div>
            <div className="form-field">
              <label>{t('protocols.loadTemplate')}</label>
              <select
                className="protocol-template-select"
                defaultValue=""
                onChange={e => {
                  if (e.target.value) {
                    applyPreset(e.target.value);
                    e.target.value = '';
                  }
                }}
              >
                <option value="" disabled>Select template…</option>
                <option value="lcp">LCP/OSP default</option>
                {presets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card rules-editor-card">
          <div className="card-header">
            <h2>{t('protocols.parseRules')}</h2>
            <div className="segmented-control">
              <button
                type="button"
                className={editMode === 'ui' ? 'is-active' : ''}
                onClick={() => setEditMode('ui')}
              >
                {t('protocols.uiMode')}
              </button>
              <button
                type="button"
                className={editMode === 'json' ? 'is-active' : ''}
                onClick={() => {
                  setEditMode('json');
                  if (!rulesError) setRulesText(documentToJson(rules));
                }}
              >
                {t('protocols.jsonMode')}
              </button>
            </div>
          </div>

          {legacyNoRules && (
            <div className="alert-banner alert-banner--warning">
              This protocol has no parse_rules. Load a template and save.
            </div>
          )}

          {rulesError && (
            <div className="alert-banner alert-banner--error">{rulesError}</div>
          )}

          {editMode === 'ui' ? (
            <ParseRulesBuilder document={rules} onChange={applyRules} />
          ) : (
            <textarea
              className="mono parse-rules-editor"
              rows={24}
              spellCheck={false}
              value={rulesText}
              onChange={e => onRulesChange(e.target.value)}
            />
          )}
        </div>

        <div className="card parse-test-card">
          <div className="card-header">
            <h2>{t('protocols.testParse')}</h2>
          </div>
          <p className="parse-test-hint">Enter HEX to validate instantly via the Go engine.</p>
          <input
            className="mono parse-test-input"
            value={testHex}
            onChange={e => setTestHex(e.target.value)}
            placeholder="AA 00 10 CF …"
          />
          {testResult && (
            <>
              {!isParseError(testResult) && (
                <div className={`parse-test-status ${parseOk ? 'ok' : 'fail'}`}>
                  {parseOk ? '✓ Valid packet' : parseCrcFail ? '✗ CRC mismatch' : '✗ Parse failed'}
                  {!parseOk && testResult.error && ` — ${testResult.error}`}
                </div>
              )}
              <pre className={`parse-test-result${parseFail ? ' is-error' : parseOk ? ' is-valid' : ''}`}>
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </>
          )}
          {!testHex && (
            <p className="muted parse-test-empty">Enter HEX to see results.</p>
          )}
        </div>
      </div>
    </div>
  );
}
