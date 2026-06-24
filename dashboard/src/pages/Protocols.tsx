import { useState, useEffect } from 'react';
import { api } from '../api';
import type { ProtocolSpec, FieldSpec, FrameDef, FIDPayload } from '../api';
import PageHeader from '../components/PageHeader';
import FieldTable from '../components/FieldTable';
import {
  LCP_FRAME,
  emptyField,
  emptyFidPayload,
  deriveDisplayFields,
  temperatureTemplate,
  detectFormat,
  type ProtocolFormat,
} from '../lib/protocolPresets';

function FramePreview({ frame }: { frame: FrameDef }) {
  const header = (frame.header || []).map(f => f.name).join(' · ');
  const tail = (frame.tail || []).map(f => f.name).join(' · ');
  return (
    <div className="frame-preview">
      <span className="frame-byte">{frame.start_byte || 'AA'}</span>
      {header && <span className="frame-seg">{header}</span>}
      <span className="frame-payload">payload</span>
      {tail && <span className="frame-seg">{tail}</span>}
      <span className="frame-byte">{frame.end_byte || 'BB'}</span>
    </div>
  );
}

export default function ProtocolsPage() {
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<ProtocolFormat>('lcp');
  const [fields, setFields] = useState<FieldSpec[]>([emptyField()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [frameDef, setFrameDef] = useState<FrameDef>(structuredClone(LCP_FRAME));
  const [fidPayloads, setFidPayloads] = useState<FIDPayload[]>([emptyFidPayload()]);
  const [envelopeOpen, setEnvelopeOpen] = useState(false);

  useEffect(() => { api.protocols.list().then(setProtocols).catch(console.error); }, []);

  const switchFormat = (next: ProtocolFormat) => {
    setFormat(next);
    if (next === 'lcp') {
      setFrameDef(structuredClone(LCP_FRAME));
      if (fidPayloads.length === 0) setFidPayloads([emptyFidPayload()]);
    } else {
      setFields([emptyField()]);
    }
  };

  const applyTemplate = (tpl: 'blank' | 'temperature') => {
    if (tpl === 'blank') {
      resetForm();
      return;
    }
    const t = temperatureTemplate();
    setName(t.name);
    setVersion(t.version);
    setDescription(t.description);
    setFormat(t.format);
    setFrameDef(structuredClone(t.frameDef));
    setFidPayloads(structuredClone(t.fidPayloads));
    setEditingId(null);
  };

  const save = async () => {
    if (!name) return;
    const displayFields =
      format === 'lcp'
        ? deriveDisplayFields(fidPayloads)
        : fields.filter(f => f.name);

    const data: Record<string, unknown> = {
      name,
      version,
      description,
      fields: displayFields,
    };

    if (format === 'lcp') {
      data.frame_def = frameDef;
      data.fid_payloads = fidPayloads
        .filter(p => p.fid)
        .map(p => ({
          ...p,
          fields: (p.fields || []).filter(f => f.name),
        }));
    }

    if (editingId) {
      await api.protocols.update(editingId, data);
      setEditingId(null);
    } else {
      await api.protocols.create(data as Parameters<typeof api.protocols.create>[0]);
    }
    resetForm();
    setProtocols(await api.protocols.list());
  };

  const resetForm = () => {
    setName('');
    setVersion('1.0');
    setDescription('');
    setFormat('lcp');
    setFields([emptyField()]);
    setFrameDef(structuredClone(LCP_FRAME));
    setFidPayloads([emptyFidPayload()]);
    setEditingId(null);
    setEnvelopeOpen(false);
  };

  const edit = (p: ProtocolSpec) => {
    const fmt = detectFormat(p);
    setName(p.name);
    setVersion(p.version);
    setDescription(p.description || '');
    setFormat(fmt);
    if (fmt === 'lcp') {
      setFrameDef(p.frame_def ? structuredClone(p.frame_def) : structuredClone(LCP_FRAME));
      setFidPayloads(
        p.fid_payloads?.length
          ? structuredClone(p.fid_payloads)
          : [emptyFidPayload()],
      );
    } else {
      setFields(p.fields.length ? structuredClone(p.fields) : [emptyField()]);
    }
    setEditingId(p.id);
    setEnvelopeOpen(false);
  };

  const remove = async (id: string) => {
    await api.protocols.delete(id);
    setProtocols(await api.protocols.list());
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

  const formatLabel = (p: ProtocolSpec) => {
    if (p.frame_def || p.fid_payloads?.length) {
      const fids = p.fid_payloads?.map(fp => `0x${fp.fid}`).join(', ') || '';
      return fids ? `LCP · ${fids}` : 'LCP';
    }
    return `Raw · ${p.fields.length} fields`;
  };

  return (
    <div className="page">
      <PageHeader
        title="Protocols"
        subtitle="UART 데이터 파싱 규칙. LCP는 AA/BB 프레임 + FID별 payload, Raw는 offset 기반 flat 파싱입니다."
      />

      <div className="card protocol-editor">
        <div className="card-header">
          <h2>{editingId ? 'Edit Protocol' : 'New Protocol'}</h2>
          <div className="btn-group">
            <button type="button" className="btn-ghost btn-sm" onClick={() => applyTemplate('blank')}>Blank</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => applyTemplate('temperature')}>Temperature preset</button>
            {editingId && (
              <button type="button" className="btn-ghost btn-sm" onClick={resetForm}>Cancel</button>
            )}
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
            aria-checked={format === 'lcp'}
            className={format === 'lcp' ? 'active' : ''}
            onClick={() => switchFormat('lcp')}
          >
            LCP Frame
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

        {format === 'lcp' && (
          <>
            <FramePreview frame={frameDef} />

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
              <h3>Messages (FID)</h3>
              <button type="button" className="btn-sm" onClick={() => setFidPayloads(prev => [...prev, emptyFidPayload()])}>+ Add FID</button>
            </div>
            <p className="muted section-hint">header의 fid 값에 따라 payload 본문을 파싱합니다. Unit은 Data Viewer 컬럼에 표시됩니다.</p>

            {fidPayloads.map((p, pi) => (
              <div key={pi} className="fid-card">
                <div className="fid-header">
                  <input
                    className="mono fid-hex"
                    value={p.fid}
                    onChange={e => updateFidPayload(pi, { fid: e.target.value.toUpperCase() })}
                    placeholder="54"
                    maxLength={2}
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
                  <button type="button" className="btn-danger btn-sm btn-icon" onClick={() => removeFidPayload(pi)} aria-label="Remove FID">×</button>
                </div>
                <FieldTable
                  fields={p.fields || [emptyField()]}
                  onChange={next => updateFidPayload(pi, { fields: next })}
                  mode="payload"
                  showUnit
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

        <div className="form-row editor-actions">
          <button type="button" onClick={save} className="btn-primary" disabled={!name}>
            {editingId ? 'Save Changes' : 'Create Protocol'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Saved Protocols</h2>
          <button
            type="button"
            className="btn-sm"
            onClick={async () => { await api.protocols.seedDefault(); setProtocols(await api.protocols.list()); }}
          >
            Seed Default
          </button>
        </div>
        <div className="protocol-grid">
          {protocols.length === 0 ? (
            <p className="muted" style={{ padding: '12px 0' }}>저장된 프로토콜이 없습니다.</p>
          ) : protocols.map(p => (
            <div key={p.id} className="protocol-item">
              <div>
                <div className="protocol-item-title">
                  {p.name} <span className="tag">v{p.version}</span>
                </div>
                {p.description && <p className="protocol-item-meta">{p.description}</p>}
                <div className="protocol-item-meta" style={{ marginTop: 6 }}>
                  {formatLabel(p)}
                </div>
              </div>
              <div className="btn-group">
                <button type="button" className="btn-sm" onClick={() => edit(p)}>Edit</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => remove(p.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
