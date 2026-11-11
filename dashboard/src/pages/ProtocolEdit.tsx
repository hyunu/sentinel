import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { JsonRuleDocument, ParseResult, SchemaPreset } from '../api';
import PageHeader from '../components/PageHeader';
import ParseRulesBuilder from '../components/ParseRulesBuilder';
import ProtocolDisplayEditor from '../components/ProtocolDisplayEditor';
import ProtocolEnumsEditor, { type ProtocolEnumMap } from '../components/ProtocolEnumsEditor';
import CollapsibleCard from '../components/CollapsibleCard';
import CollapsibleSection from '../components/CollapsibleSection';
import ParseRulesManual from '../components/ParseRulesManual';
import { useTranslation } from '../i18n';
import { DEFAULT_LCP_PARSE_RULES } from '../lib/protocolFormat';
import { blankParseRules, documentToJson, normalizeParseRulesDocument } from '../lib/ruleBuilderUtils';

function normalizeParseRules(raw?: JsonRuleDocument | null): JsonRuleDocument {
  return structuredClone(normalizeParseRulesDocument(raw));
}

function extractLegacyEnums(doc?: JsonRuleDocument | null): ProtocolEnumMap {
  const raw = doc?._meta?.enums;
  if (!raw || typeof raw !== 'object') return {};
  const out: ProtocolEnumMap = {};
  for (const [name, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!values || typeof values !== 'object') continue;
    const map: Record<string, string> = {};
    for (const [key, label] of Object.entries(values as Record<string, unknown>)) {
      map[String(key)] = String(label);
    }
    out[name] = map;
  }
  return out;
}

/** Keep parse_rules free of enums; they are edited in their own protocol group. */
function stripRulesEnums(doc: JsonRuleDocument): JsonRuleDocument {
  const clone = structuredClone(doc);
  const meta = clone._meta as Record<string, unknown> | undefined;
  if (meta && 'enums' in meta) {
    delete meta.enums;
    if (Object.keys(meta).length === 0) delete clone._meta;
  }
  return clone;
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
  const [enums, setEnums] = useState<ProtocolEnumMap>({});
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
    const cleaned = stripRulesEnums(doc);
    setRules(cleaned);
    setRulesText(documentToJson(cleaned));
    setRulesError('');
    setLegacyNoRules(false);
  }, []);

  useEffect(() => {
    api.schemaPresets.list().then(setPresets).catch(console.error);
  }, []);

  useEffect(() => {
    if (isNew || !id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    setLoading(true);
    api.protocols.get(id)
      .then(p => {
        setName(p.name);
        setVersion(p.version);
        setDescription(p.description || '');
        const hasRules = Boolean(p.parse_rules?.fields?.length);
        setLegacyNoRules(!hasRules);
        setEnums(
          p.enums && Object.keys(p.enums).length > 0
            ? p.enums
            : extractLegacyEnums(p.parse_rules),
        );
        applyRules(normalizeParseRules(p.parse_rules));
      })
      .catch(() => navigate('/protocols'))
      .finally(() => setLoading(false));
  }, [id, isNew, navigate, applyRules]);

  const onRulesChange = (text: string) => {
    setRulesText(text);
    try {
      const parsed = JSON.parse(text) as JsonRuleDocument;
      const legacy = extractLegacyEnums(parsed);
      if (Object.keys(legacy).length > 0) {
        setEnums(prev => ({ ...legacy, ...prev }));
      }
      applyRules(parsed);
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
      const body = {
        name,
        version,
        description,
        parse_rules: stripRulesEnums(rules),
        enums,
      };
      if (isNew) await api.protocols.create(body);
      else if (id) await api.protocols.update(id, body);
      navigate('/protocols');
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (presetId: string) => {
    if (presetId === 'lcp') {
      const doc = structuredClone(DEFAULT_LCP_PARSE_RULES);
      setEnums(extractLegacyEnums(doc));
      applyRules(doc);
      return;
    }
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    setName(preset.name);
    setVersion(preset.protocol_version || '1.0');
    setDescription(preset.description || '');
    const doc = normalizeParseRules(preset.parse_rules);
    setEnums(
      preset.enums && Object.keys(preset.enums).length > 0
        ? preset.enums
        : extractLegacyEnums(doc),
    );
    applyRules(doc);
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
        <CollapsibleCard title={t('common.general')} className="protocol-info-card">
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
        </CollapsibleCard>

        <CollapsibleCard
          title={t('protocols.parseRules')}
          className="rules-editor-card"
          actions={(
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
                  if (!rulesError) setRulesText(documentToJson(stripRulesEnums(rules)));
                }}
              >
                {t('protocols.jsonMode')}
              </button>
            </div>
          )}
        >
          {legacyNoRules && (
            <div className="alert-banner alert-banner--warning">
              {t('protocols.noRulesWarning')}
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
        </CollapsibleCard>

        <CollapsibleCard title={t('protocols.enums')} className="protocol-enums-card">
          <ProtocolEnumsEditor enums={enums} onChange={setEnums} />
          <CollapsibleSection
            title={t('protocols.fieldDisplay')}
            className="protocol-display-section"
          >
            <ProtocolDisplayEditor document={rules} onChange={applyRules} enums={enums} />
          </CollapsibleSection>
        </CollapsibleCard>

        <CollapsibleCard title={t('protocols.testParse')} className="parse-test-card">
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
        </CollapsibleCard>
      </div>
    </div>
  );
}
