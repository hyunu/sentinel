import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { ProtocolSpec, FieldSpec, FrameDef, FIDPayload, SchemaPreset } from '../api';
import PageHeader from '../components/PageHeader';
import { PayloadFieldEditor } from '../components/FieldSchemaEditor';
import FieldTable from '../components/FieldTable';
import SchemaPresetsPanel, {
  applyFramePreset,
  applyProtocolPreset,
  presetToPayloadOptions,
} from '../components/SchemaPresetsPanel';
import {
  LCP_FRAME,
  emptyField,
  emptyFidPayload,
  deriveDisplayFields,
  detectFormat,
  type ProtocolFormat,
} from '../lib/protocolPresets';
import { parseProtocolHex } from '../lib/uartParse';

function FramePreview({ frame }: { frame: FrameDef }) {
  const header = (frame.header || []).map(f => f.name).join(' · ');
  const tail = (frame.tail || []).map(f => f.name).join(' · ');
  const key = frame.payload_key_field || 'fid';
  return (
    <div className="frame-preview">
      <span className="frame-byte">{frame.start_byte || 'AA'}</span>
      {header && <span className="frame-seg">{header}</span>}
      <span className="frame-payload">payload ({key})</span>
      {tail && <span className="frame-seg">{tail}</span>}
      <span className="frame-byte">{frame.end_byte || 'BB'}</span>
    </div>
  );
}

function buildDraftSpec(
  format: ProtocolFormat,
  frameDef: FrameDef,
  fidPayloads: FIDPayload[],
  fields: FieldSpec[],
): ProtocolSpec {
  const displayFields =
    format === 'frame'
      ? deriveDisplayFields(fidPayloads)
      : fields.filter(f => f.name);

  return {
    id: 'draft',
    name: '',
    version: '1.0',
    fields: displayFields,
    frame_def: format === 'frame' ? frameDef : undefined,
    fid_payloads: format === 'frame'
      ? fidPayloads.filter(p => p.fid).map(p => ({ ...p, fields: (p.fields || []).filter(f => f.name) }))
      : undefined,
    created_at: '',
    updated_at: '',
  };
}

function blankFormState() {
  return {
    name: '',
    version: '1.0',
    description: '',
    format: 'frame' as ProtocolFormat,
    fields: [emptyField()],
    frameDef: structuredClone(LCP_FRAME),
    fidPayloads: [emptyFidPayload()],
    envelopeOpen: false,
    testHex: '',
  };
}

export default function ProtocolEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const [loading, setLoading] = useState(!isNew);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<ProtocolFormat>('frame');
  const [fields, setFields] = useState<FieldSpec[]>([emptyField()]);
  const [frameDef, setFrameDef] = useState<FrameDef>(structuredClone(LCP_FRAME));
  const [fidPayloads, setFidPayloads] = useState<FIDPayload[]>([emptyFidPayload()]);
  const [envelopeOpen, setEnvelopeOpen] = useState(false);
  const [testHex, setTestHex] = useState('');
  const [schemaPresets, setSchemaPresets] = useState<SchemaPreset[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.schemaPresets.list().then(setSchemaPresets).catch(console.error);
  }, []);

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    api.protocols.get(id)
      .then(p => {
        const fmt = detectFormat(p);
        setName(p.name);
        setVersion(p.version);
        setDescription(p.description || '');
        setFormat(fmt);
        if (fmt === 'frame') {
          setFrameDef(p.frame_def ? structuredClone(p.frame_def) : structuredClone(LCP_FRAME));
          setFidPayloads(
            p.fid_payloads?.length ? structuredClone(p.fid_payloads) : [emptyFidPayload()],
          );
        } else {
          setFields(p.fields.length ? structuredClone(p.fields) : [emptyField()]);
        }
        setEnvelopeOpen(false);
        setTestHex('');
      })
      .catch(err => {
        console.error(err);
        navigate('/protocols');
      })
      .finally(() => setLoading(false));
  }, [id, isNew, navigate]);

  const payloadPresetOptions = useMemo(() => presetToPayloadOptions(schemaPresets), [schemaPresets]);
  const framePresets = useMemo(() => schemaPresets.filter(p => p.category === 'frame'), [schemaPresets]);
  const protocolPresets = useMemo(() => schemaPresets.filter(p => p.category === 'protocol'), [schemaPresets]);

  const draftSpec = useMemo(
    () => buildDraftSpec(format, frameDef, fidPayloads, fields),
    [format, frameDef, fidPayloads, fields],
  );

  const testResult = useMemo(() => {
    const hex = testHex.replace(/\s/g, '');
    if (!hex || hex.length < 2) return null;
    try {
      return parseProtocolHex(hex, draftSpec);
    } catch {
      return { error: 'Invalid hex' };
    }
  }, [testHex, draftSpec]);

  const switchFormat = (next: ProtocolFormat) => {
    setFormat(next);
    if (next === 'frame') {
      setFrameDef(structuredClone(LCP_FRAME));
      if (fidPayloads.length === 0) setFidPayloads([emptyFidPayload()]);
    } else {
      setFields([emptyField()]);
    }
  };

  const resetForm = () => {
    const blank = blankFormState();
    setName(blank.name);
    setVersion(blank.version);
    setDescription(blank.description);
    setFormat(blank.format);
    setFields(blank.fields);
    setFrameDef(blank.frameDef);
    setFidPayloads(blank.fidPayloads);
    setEnvelopeOpen(blank.envelopeOpen);
    setTestHex(blank.testHex);
  };

  const applyProtocolTemplate = (preset: SchemaPreset) => {
    const applied = applyProtocolPreset(preset);
    setName(applied.name);
    setVersion(applied.version);
    setDescription(applied.description);
    setFormat('frame');
    setFrameDef(applied.frameDef);
    setFidPayloads(applied.fidPayloads);
  };

  const save = async () => {
    if (!name || saving) return;
    setSaving(true);
    try {
      const displayFields =
        format === 'frame'
          ? deriveDisplayFields(fidPayloads)
          : fields.filter(f => f.name);

      const data: Record<string, unknown> = {
        name,
        version,
        description,
        fields: displayFields,
      };

      if (format === 'frame') {
        data.frame_def = frameDef;
        data.fid_payloads = fidPayloads
          .filter(p => p.fid)
          .map(p => ({
            ...p,
            fields: (p.fields || []).filter(f => f.name),
          }));
      }

      if (isNew) {
        await api.protocols.create(data as Parameters<typeof api.protocols.create>[0]);
      } else if (id) {
        await api.protocols.update(id, data);
      }
      navigate('/protocols');
    } finally {
      setSaving(false);
    }
  };

  const updateFrameHeader = (i: number, key: string, value: unknown) => {
    setFrameDef({
      ...frameDef,
      header: frameDef.header.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)),
    });
  };

  const updateFrameTail = (i: number, key: string, value: unknown) => {
    setFrameDef({
      ...frameDef,
      tail: frameDef.tail.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)),
    });
  };

  const updateFidPayload = (i: number, patch: Partial<FIDPayload>) => {
    setFidPayloads(prev => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const removeFidPayload = (i: number) => {
    setFidPayloads(prev => (prev.length <= 1 ? [emptyFidPayload()] : prev.filter((_, idx) => idx !== i)));
  };

  const dispatchField = frameDef.payload_key_field || 'fid';

  if (loading) {
    return (
      <div className="page">
        <p className="muted">프로토콜 불러오는 중…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-breadcrumb">
        <Link to="/protocols" className="page-back-link">← Protocols</Link>
      </div>

      <PageHeader
        title={isNew ? 'New Protocol' : 'Edit Protocol'}
        subtitle="프레임 envelope, FID별 payload, Parse test. 저장 후 목록으로 돌아갑니다."
      />

      <div className="card protocol-editor">
        <div className="card-header">
          <h2>{isNew ? 'Create' : name || 'Untitled'}</h2>
          <div className="btn-group">
            <button type="button" className="btn-ghost btn-sm" onClick={resetForm}>Reset</button>
            {protocolPresets.map(p => (
              <button
                key={p.id}
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => applyProtocolTemplate(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="protocol-meta-row">
          <div className="form-field protocol-meta-name">
            <label>Name</label>
            <input placeholder="Temperature Telemetry" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-field protocol-meta-version">
            <label>Version</label>
            <input placeholder="1.0" value={version} onChange={e => setVersion(e.target.value)} />
          </div>
          <div className="form-field protocol-meta-desc">
            <label>Description</label>
            <input placeholder="프로토콜 설명" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="format-toggle" role="radiogroup" aria-label="Protocol format">
          <button
            type="button"
            role="radio"
            aria-checked={format === 'frame'}
            className={format === 'frame' ? 'active' : ''}
            onClick={() => switchFormat('frame')}
          >
            UART Frame
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={format === 'raw'}
            className={format === 'raw' ? 'active' : ''}
            onClick={() => switchFormat('raw')}
          >
            Raw bytes
          </button>
        </div>

        {format === 'frame' && (
          <>
            <FramePreview frame={frameDef} />

            {framePresets.length > 0 && (
              <div className="field-schema-presets btn-group" style={{ margin: '8px 0' }}>
                <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>Frame preset:</span>
                {framePresets.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setFrameDef(applyFramePreset(p))}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              className="envelope-toggle"
              onClick={() => setEnvelopeOpen(v => !v)}
            >
              {envelopeOpen ? '▾' : '▸'} Frame envelope (advanced)
            </button>

            {envelopeOpen && (
              <div className="envelope-panel">
                <div className="form-row">
                  <div className="form-field" style={{ flex: '0 0 auto' }}>
                    <label>Start</label>
                    <input className="mono" value={frameDef.start_byte} onChange={e => setFrameDef({ ...frameDef, start_byte: e.target.value })} style={{ width: 56 }} />
                  </div>
                  <div className="form-field" style={{ flex: '0 0 auto' }}>
                    <label>End</label>
                    <input className="mono" value={frameDef.end_byte} onChange={e => setFrameDef({ ...frameDef, end_byte: e.target.value })} style={{ width: 56 }} />
                  </div>
                  <div className="form-field" style={{ flex: '0 0 auto' }}>
                    <label>Payload key</label>
                    <input
                      className="mono"
                      value={frameDef.payload_key_field || 'fid'}
                      onChange={e => setFrameDef({ ...frameDef, payload_key_field: e.target.value })}
                      style={{ width: 72 }}
                      placeholder="fid"
                    />
                  </div>
                  <div className="form-field" style={{ flex: '0 0 auto' }}>
                    <label>Length field</label>
                    <input
                      className="mono"
                      value={frameDef.length_field || 'length'}
                      onChange={e => setFrameDef({ ...frameDef, length_field: e.target.value })}
                      style={{ width: 72 }}
                      placeholder="length"
                    />
                  </div>
                  <div className="form-field" style={{ flex: '0 0 auto' }}>
                    <label>Endian</label>
                    <select value={frameDef.endian} onChange={e => setFrameDef({ ...frameDef, endian: e.target.value })}>
                      <option value="big">Big</option>
                      <option value="little">Little</option>
                    </select>
                  </div>
                  <div className="form-field" style={{ flex: '0 0 auto' }}>
                    <label>CRC</label>
                    <select value={frameDef.crc_position || 'before_end'} onChange={e => setFrameDef({ ...frameDef, crc_position: e.target.value })}>
                      <option value="before_end">Before end</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                </div>
                <p className="muted section-hint" style={{ marginTop: 8 }}>
                  header의 <code>{dispatchField}</code> 값으로 아래 Messages 스키마를 선택합니다.
                </p>
                <p className="muted" style={{ margin: '8px 0 4px', fontSize: 12 }}>Header</p>
                {(frameDef.header || []).map((f, i) => (
                  <div key={i} className="field-row compact">
                    <input value={f.name} onChange={e => updateFrameHeader(i, 'name', e.target.value)} style={{ width: 90 }} />
                    <select value={f.type} onChange={e => updateFrameHeader(i, 'type', e.target.value)} style={{ width: 80 }}>
                      <option value="uint8">uint8</option>
                      <option value="uint16">uint16</option>
                      <option value="uint32">uint32</option>
                    </select>
                    <input type="number" value={f.length ?? 1} onChange={e => updateFrameHeader(i, 'length', parseInt(e.target.value, 10) || 1)} style={{ width: 48 }} />
                    <select value={f.endian || 'big'} onChange={e => updateFrameHeader(i, 'endian', e.target.value)} style={{ width: 64 }}>
                      <option value="little">LE</option>
                      <option value="big">BE</option>
                    </select>
                  </div>
                ))}
                <p className="muted" style={{ margin: '8px 0 4px', fontSize: 12 }}>Tail</p>
                {(frameDef.tail || []).map((f, i) => (
                  <div key={i} className="field-row compact">
                    <input value={f.name} onChange={e => updateFrameTail(i, 'name', e.target.value)} style={{ width: 90 }} />
                    <select value={f.type} onChange={e => updateFrameTail(i, 'type', e.target.value)} style={{ width: 80 }}>
                      <option value="uint8">uint8</option>
                      <option value="uint16">uint16</option>
                      <option value="uint32">uint32</option>
                    </select>
                    <input type="number" value={f.length ?? 1} onChange={e => updateFrameTail(i, 'length', parseInt(e.target.value, 10) || 1)} style={{ width: 48 }} />
                    <select value={f.endian || 'big'} onChange={e => updateFrameTail(i, 'endian', e.target.value)} style={{ width: 64 }}>
                      <option value="little">LE</option>
                      <option value="big">BE</option>
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div className="section-header">
              <h3>Messages ({dispatchField})</h3>
              <button type="button" className="btn-sm" onClick={() => setFidPayloads(prev => [...prev, emptyFidPayload()])}>+ Add message</button>
            </div>
            <p className="muted section-hint">
              header.{dispatchField} 값(hex)에 따라 payload 본문을 파싱합니다.
            </p>

            {fidPayloads.map((p, pi) => (
              <div key={pi} className="fid-card">
                <div className="fid-header">
                  <input
                    className="mono fid-hex"
                    value={p.fid}
                    onChange={e => updateFidPayload(pi, { fid: e.target.value.toUpperCase() })}
                    placeholder="54"
                    maxLength={4}
                  />
                  <input
                    value={p.name}
                    onChange={e => updateFidPayload(pi, { name: e.target.value })}
                    placeholder="Message name"
                  />
                  <input
                    value={p.description || ''}
                    onChange={e => updateFidPayload(pi, { description: e.target.value })}
                    placeholder="Description"
                  />
                  <button type="button" className="btn-danger btn-sm btn-icon" onClick={() => removeFidPayload(pi)} aria-label="Remove message">×</button>
                </div>
                <PayloadFieldEditor
                  fields={p.fields?.length ? p.fields : [emptyField()]}
                  onChange={next => updateFidPayload(pi, { fields: next })}
                  showUnit
                  presets={payloadPresetOptions}
                />
              </div>
            ))}
          </>
        )}

        {format === 'raw' && (
          <>
            <div className="section-header">
              <h3>Fields</h3>
            </div>
            <p className="muted section-hint">전체 hex를 byte offset 기준으로 파싱합니다.</p>
            <FieldTable fields={fields} onChange={setFields} mode="raw" />
          </>
        )}

        <div className="parse-test-panel">
          <div className="section-header">
            <h3>Parse test</h3>
          </div>
          <p className="muted section-hint">저장 전 현재 스키마로 hex를 해석합니다 (클라이언트 파서).</p>
          <input
            className="mono parse-test-input"
            value={testHex}
            onChange={e => setTestHex(e.target.value)}
            placeholder="AA000854..."
          />
          {testResult && (
            <pre className="parse-test-output">{JSON.stringify(testResult, null, 2)}</pre>
          )}
        </div>

        <div className="form-row editor-actions">
          <Link to="/protocols" className="btn-ghost">Cancel</Link>
          <button type="button" onClick={save} className="btn-primary" disabled={!name || saving}>
            {saving ? 'Saving…' : isNew ? 'Create Protocol' : 'Save Changes'}
          </button>
        </div>
      </div>

      <SchemaPresetsPanel onChange={() => api.schemaPresets.list().then(setSchemaPresets).catch(console.error)} />
    </div>
  );
}
