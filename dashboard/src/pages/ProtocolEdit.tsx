import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { JsonRuleDocument, ParseResult, SchemaPreset } from '../api';
import PageHeader from '../components/PageHeader';
import ParseRulesBuilder from '../components/ParseRulesBuilder';
import { DEFAULT_LCP_PARSE_RULES } from '../lib/protocolFormat';
import { documentToJson } from '../lib/ruleBuilderUtils';

function emptyRules(): JsonRuleDocument {
  return structuredClone(DEFAULT_LCP_PARSE_RULES);
}

function normalizeParseRules(raw?: JsonRuleDocument | null): JsonRuleDocument {
  if (raw?.fields?.length) return structuredClone(raw);
  return emptyRules();
}

function isParseError(result: ParseResult | { error: string }): result is { error: string } {
  return 'error' in result && typeof result.error === 'string';
}

export default function ProtocolEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const [loading, setLoading] = useState(!isNew);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0');
  const [description, setDescription] = useState('');
  const [rulesText, setRulesText] = useState(JSON.stringify(emptyRules(), null, 2));
  const [rules, setRules] = useState<JsonRuleDocument>(() => emptyRules());
  const [rulesError, setRulesError] = useState('');
  const [legacyNoRules, setLegacyNoRules] = useState(false);
  const [testHex, setTestHex] = useState('');
  const [testResult, setTestResult] = useState<ParseResult | { error: string } | null>(null);
  const [presets, setPresets] = useState<SchemaPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState<'ui' | 'json'>('ui');

  const applyRules = useCallback((doc: JsonRuleDocument) => {
    if (!doc.fields?.length) {
      setRulesError('최소 1개 이상의 필드가 필요합니다.');
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
      setRulesError(e instanceof Error ? e.message : 'JSON 형식이 올바르지 않습니다.');
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
      setTestResult({ error: e instanceof Error ? e.message : '파싱에 실패했습니다.' });
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
        <p className="muted">프로토콜을 불러오는 중…</p>
      </div>
    );
  }

  const parseOk = testResult && !isParseError(testResult) && testResult.valid;
  const parseCrcFail = testResult && !isParseError(testResult) && !testResult.valid;
  const parseFail = testResult && (isParseError(testResult) || parseCrcFail);

  return (
    <div className="page protocol-edit-page">
      <div className="page-breadcrumb">
        <Link to="/protocols" className="page-back-link">← Protocols</Link>
      </div>

      <div className="protocol-edit-toolbar">
        <PageHeader
          title={isNew ? '새 프로토콜' : '프로토콜 편집'}
          subtitle="UI로 패킷 구조를 정의하면 parse_rules JSON이 자동 생성됩니다."
        />
        <div className="protocol-edit-toolbar-actions">
          <Link to="/protocols" className="btn-ghost">취소</Link>
          <button
            type="button"
            className="btn-primary"
            disabled={!name || !!rulesError || saving}
            onClick={save}
          >
            {saving ? '저장 중…' : isNew ? '생성' : '저장'}
          </button>
        </div>
      </div>

      <div className="protocol-edit-stack">
        <div className="card protocol-info-card">
          <div className="card-header">
            <h2>기본 정보</h2>
          </div>
          <div className="protocol-info-grid">
            <div className="form-field">
              <label>프로토콜 이름</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="LCP Protocol" />
            </div>
            <div className="form-field">
              <label>버전</label>
              <input value={version} onChange={e => setVersion(e.target.value)} />
            </div>
            <div className="form-field">
              <label>설명</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="선택 사항" />
            </div>
            <div className="form-field">
              <label>템플릿 불러오기</label>
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
                <option value="" disabled>템플릿 선택…</option>
                <option value="lcp">LCP/OSP 기본</option>
                {presets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card rules-editor-card">
          <div className="card-header">
            <h2>파싱 규칙</h2>
            <div className="segmented-control">
              <button
                type="button"
                className={editMode === 'ui' ? 'is-active' : ''}
                onClick={() => setEditMode('ui')}
              >
                시각 편집
              </button>
              <button
                type="button"
                className={editMode === 'json' ? 'is-active' : ''}
                onClick={() => {
                  setEditMode('json');
                  if (!rulesError) setRulesText(documentToJson(rules));
                }}
              >
                JSON
              </button>
            </div>
          </div>

          {legacyNoRules && (
            <div className="alert-banner alert-banner--warning">
              이 프로토콜에 parse_rules가 없습니다. 템플릿을 불러온 뒤 저장해 주세요.
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
            <h2>파싱 테스트</h2>
          </div>
          <p className="parse-test-hint">HEX 입력 시 서버(Go engine)로 즉시 검증합니다.</p>
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
                  {parseOk ? '✓ 유효한 패킷' : parseCrcFail ? '✗ CRC 불일치' : '✗ 파싱 실패'}
                  {!parseOk && testResult.error && ` — ${testResult.error}`}
                </div>
              )}
              <pre className={`parse-test-result${parseFail ? ' is-error' : parseOk ? ' is-valid' : ''}`}>
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </>
          )}
          {!testHex && (
            <p className="muted parse-test-empty">HEX를 입력하면 결과가 표시됩니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}
