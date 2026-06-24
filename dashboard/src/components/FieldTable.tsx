import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { FieldSpec } from '../api';
import { FIELD_TYPES, FIELD_TYPES_ADVANCED } from '../lib/protocolPresets';

const POPOVER_W = 380;

type FieldTableProps = {
  fields: FieldSpec[];
  onChange: (fields: FieldSpec[]) => void;
  mode: 'raw' | 'payload';
  showUnit?: boolean;
};

const TYPES = (mode: 'raw' | 'payload') =>
  mode === 'payload' ? FIELD_TYPES_ADVANCED : FIELD_TYPES;

function DecorationHelp() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const margin = 8;
    let left = rect.right - POPOVER_W;
    if (left < margin) left = margin;
    if (left + POPOVER_W > window.innerWidth - margin) {
      left = window.innerWidth - POPOVER_W - margin;
    }
    setPos({ top: rect.bottom + 6, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="info-icon-btn"
        aria-label="Decoration 수식 도움말"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        i
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="decoration-help-popover"
          role="dialog"
          aria-label="Decoration 수식"
          style={{ top: pos.top, left: pos.left, width: POPOVER_W }}
        >
          <p className="decoration-help-title">지원 수식</p>
          <dl className="decoration-help-list">
            <div>
              <dt>v</dt>
              <dd>endian·type 기준으로 파싱한 정수값</dd>
            </div>
            <div>
              <dt>{'{표현식}'}</dt>
              <dd>중괄호 안 수식을 계산해 문자열에 삽입</dd>
            </div>
            <div>
              <dt>연산자</dt>
              <dd><code>+</code> <code>-</code> <code>*</code> <code>/</code> <code>%</code> · 괄호 <code>( )</code></dd>
            </div>
            <div>
              <dt>예시</dt>
              <dd><code>{'{v/10}.{v%10}'}</code> → v=235 이면 <code>23.5</code></dd>
            </div>
            <div>
              <dt>리터럴</dt>
              <dd>중괄호 밖 텍스트는 그대로 출력 (예: <code>{'ID:{v}'}</code>)</dd>
            </div>
          </dl>
        </div>,
        document.body,
      )}
    </>
  );
}

export default function FieldTable({ fields, onChange, mode, showUnit }: FieldTableProps) {
  const types = TYPES(mode);

  const update = (i: number, patch: Partial<FieldSpec>) => {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };

  const remove = (i: number) => {
    if (fields.length <= 1) {
      onChange([{ name: '', offset: 0, length: 1, type: 'uint8', endian: 'little' }]);
      return;
    }
    onChange(fields.filter((_, idx) => idx !== i));
  };

  const add = () => onChange([...fields, { name: '', offset: 0, length: 1, type: 'uint8', endian: 'little' }]);

  return (
    <div className="field-table-wrap">
      <table className={`field-table field-table--${mode}`}>
        <colgroup>
          <col className="col-name" />
          <col className="col-type" />
          {mode === 'raw' && <col className="col-offset" />}
          <col className="col-len" />
          <col className="col-endian" />
          {showUnit && <col className="col-unit" />}
          {mode === 'payload' && <col className="col-flag" />}
          <col className="col-decoration" />
          <col className="col-action" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            {mode === 'raw' && <th>Offset</th>}
            <th>Len</th>
            <th>Endian</th>
            {showUnit && <th>Unit</th>}
            {mode === 'payload' && <th>Flag</th>}
            <th className="col-decoration-header">
              <span className="th-label-with-info">
                Decoration
                <DecorationHelp />
              </span>
            </th>
            <th aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {fields.map((f, i) => (
            <tr key={i}>
              <td>
                <input
                  value={f.name}
                  placeholder="field_name"
                  onChange={e => update(i, { name: e.target.value })}
                />
              </td>
              <td>
                <select value={f.type} onChange={e => update(i, { type: e.target.value })}>
                  {types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              {mode === 'raw' && (
                <td>
                  <input
                    className="field-num"
                    type="number"
                    min={0}
                    value={f.offset ?? 0}
                    onChange={e => update(i, { offset: parseInt(e.target.value, 10) || 0 })}
                  />
                </td>
              )}
              <td>
                <input
                  className="field-num"
                  type="number"
                  min={0}
                  value={f.length ?? 1}
                  onChange={e => update(i, { length: parseInt(e.target.value, 10) || 1 })}
                />
              </td>
              <td>
                <select
                  value={f.endian || 'little'}
                  onChange={e => update(i, { endian: e.target.value })}
                >
                  <option value="little">LE</option>
                  <option value="big">BE</option>
                </select>
              </td>
              {showUnit && (
                <td>
                  <input
                    className="field-unit"
                    value={f.unit || ''}
                    placeholder="°C"
                    onChange={e => update(i, { unit: e.target.value })}
                  />
                </td>
              )}
              {mode === 'payload' && (
                <td>
                  <input
                    className="mono field-flag"
                    value={f.flag || ''}
                    placeholder="—"
                    onChange={e => update(i, { flag: e.target.value })}
                  />
                </td>
              )}
              <td>
                <input
                  className="mono field-decoration"
                  value={f.decoration || ''}
                  placeholder="{v/10}.{v%10}"
                  onChange={e => update(i, { decoration: e.target.value })}
                />
              </td>
              <td className="col-action-cell">
                <button type="button" className="btn-danger btn-sm btn-icon" onClick={() => remove(i)} aria-label="Remove field">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn-sm field-table-add" onClick={add}>+ Add field</button>
    </div>
  );
}
