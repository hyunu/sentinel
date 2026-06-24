import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
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

function ColumnHelp({ title, ariaLabel, children }: { title: string; ariaLabel: string; children: ReactNode }) {
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
        aria-label={ariaLabel}
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
          aria-label={ariaLabel}
          style={{ top: pos.top, left: pos.left, width: POPOVER_W }}
        >
          <p className="decoration-help-title">{title}</p>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

function HelpList({ items }: { items: { term: string; desc: ReactNode }[] }) {
  return (
    <dl className="decoration-help-list">
      {items.map(({ term, desc }) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{desc}</dd>
        </div>
      ))}
    </dl>
  );
}

function ThWithHelp({ label, ariaLabel, title, children }: { label: string; ariaLabel: string; title: string; children: ReactNode }) {
  return (
    <th>
      <span className="th-label-with-info">
        {label}
        <ColumnHelp title={title} ariaLabel={ariaLabel}>{children}</ColumnHelp>
      </span>
    </th>
  );
}

function NameHelp() {
  return (
    <HelpList items={[
      { term: '역할', desc: '파싱 결과 키이자 Data Viewer 컬럼 이름' },
      { term: '형식', desc: 'snake_case 권장 (예: temperature_celsius)' },
      { term: '저장', desc: 'parsed_fields[field_name] 으로 저장됨' },
    ]} />
  );
}

function TypeHelp({ mode }: { mode: 'raw' | 'payload' }) {
  return (
    <HelpList items={[
      { term: '정수/실수', desc: <>uint8 · uint16 · uint32 · int8 · int16 · float — Len과 함께 해석</> },
      { term: '문자/바이너리', desc: 'ascii · hex · raw' },
      ...(mode === 'payload' ? [
        { term: 'LCP 전용', desc: 'dynamic · function_args · func_result — 가변/중첩 구조' },
      ] : []),
      { term: 'Endian', desc: '2바이트 이상 정수·float 에서 바이트 순서 (LE/BE)' },
    ]} />
  );
}

function OffsetHelp() {
  return (
    <HelpList items={[
      { term: '인덱스', desc: '전체 hex 버퍼 시작(0) 기준 바이트 위치' },
      { term: 'Raw 전용', desc: 'LCP payload 는 필드 순서로 자동 진행 (Offset 없음)' },
      { term: '예시', desc: 'Offset=4, Len=2 → 5~6번째 바이트를 uint16 으로 읽음' },
    ]} />
  );
}

function BitsHelp() {
  return (
    <HelpList items={[
      { term: '0', desc: '바이트 필드 — Type+Len 으로 읽음' },
      { term: '1+', desc: '비트 필드 — 읽을 비트 개수 (1bit, 2bit, …)' },
      { term: '연동', desc: 'Bits &gt; 0 이면 BitOff·Len(컨테이너) 사용' },
      { term: '예시', desc: 'Bits=4 → 니블(4bit) 값' },
    ]} />
  );
}

function EndianHelp() {
  return (
    <HelpList items={[
      { term: 'LE', desc: 'Little-endian — 하위 바이트가 앞 (ESP32 등)' },
      { term: 'BE', desc: 'Big-endian — 상위 바이트가 앞 (네트워크/LCP 헤더)' },
      { term: '적용', desc: 'Len ≥ 2 인 uint/int/float 에서 의미 있음' },
      { term: '비트 필드', desc: 'Bits &gt; 0 일 때는 보통 무시' },
    ]} />
  );
}

function UnitHelp() {
  return (
    <HelpList items={[
      { term: '표시', desc: 'Data Viewer 컬럼에 단위만 붙여 표시 (파싱에 영향 없음)' },
      { term: '예시', desc: '°C · % · V · mA' },
      { term: 'Decoration', desc: '연산 결과에도 동일 unit 이 적용됨' },
    ]} />
  );
}

function FlagHelp() {
  return (
    <HelpList items={[
      { term: '역할', desc: 'LCP 중첩 필드 분기용 1바이트 hex 코드' },
      { term: '예시', desc: 'FA(argument) · FD(success) · FE(error)' },
      { term: '매칭', desc: 'function_args / func_result 파싱 시 해당 flag 행만 적용' },
      { term: '일반 FID', desc: 'Temperature 등 단순 payload 는 보통 비움' },
    ]} />
  );
}

function DecorationHelp() {
  return (
    <HelpList items={[
      { term: 'v', desc: 'endian·type 기준으로 파싱한 정수값' },
      { term: '{표현식}', desc: '중괄호 안 수식을 계산해 문자열에 삽입' },
      { term: '연산자', desc: <><code>+</code> <code>-</code> <code>*</code> <code>/</code> <code>%</code> · 괄호 <code>( )</code></> },
      { term: '예시', desc: <><code>{'{v/10}.{v%10}'}</code> → v=235 이면 <code>23.5</code></> },
      { term: '리터럴', desc: <>중괄호 밖 텍스트는 그대로 출력 (예: <code>{'ID:{v}'}</code>)</> },
    ]} />
  );
}

function LenHelp({ mode }: { mode: 'raw' | 'payload' }) {
  return (
    <HelpList items={[
      { term: '크기', desc: <>인덱스가 아니라 <strong>읽을 바이트 수</strong></> },
      ...(mode === 'raw' ? [{ term: 'Offset', desc: <>버퍼 시작 기준 <strong>바이트 인덱스</strong> — Len 과 별개</> }] : []),
      { term: '바이트 필드', desc: 'Len=1 → uint8, Len=2 → uint16, Len=4 → float32' },
      { term: '비트 필드', desc: <>Bits &gt; 0 일 때 비트 <strong>컨테이너</strong> 바이트 수 (보통 1)</> },
      ...(mode === 'payload' ? [{ term: 'LCP', desc: '필드 순서대로 자동 진행, Len 만 크기 지정' }] : []),
    ]} />
  );
}

function BitOffHelp() {
  return (
    <HelpList items={[
      { term: 'auto', desc: '비워 두면 이전 비트 필드 다음부터 자동 패킹' },
      { term: '0–7', desc: 'Len 컨테이너 안 고정 시작 비트. 0=LSB(최하위)' },
      { term: '예시', desc: 'priority BitOff=0 Bits=4, retry BitOff=4 Bits=4' },
      { term: 'Bits=0', desc: '바이트 필드일 때 사용하지 않음 (—)' },
    ]} />
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
          <col className="col-bit-off" />
          <col className="col-bit-len" />
          <col className="col-endian" />
          {showUnit && <col className="col-unit" />}
          {mode === 'payload' && <col className="col-flag" />}
          <col className="col-decoration" />
          <col className="col-action" />
        </colgroup>
        <thead>
          <tr>
            <ThWithHelp label="Name" title="Name (필드 이름)" ariaLabel="Name 도움말"><NameHelp /></ThWithHelp>
            <ThWithHelp label="Type" title="Type (데이터 타입)" ariaLabel="Type 도움말"><TypeHelp mode={mode} /></ThWithHelp>
            {mode === 'raw' && (
              <ThWithHelp label="Offset" title="Offset (바이트 인덱스)" ariaLabel="Offset 도움말"><OffsetHelp /></ThWithHelp>
            )}
            <ThWithHelp label="Len" title="Len (바이트 크기)" ariaLabel="Len 도움말"><LenHelp mode={mode} /></ThWithHelp>
            <ThWithHelp label="BitOff" title="BitOff (비트 시작)" ariaLabel="BitOff 도움말"><BitOffHelp /></ThWithHelp>
            <ThWithHelp label="Bits" title="Bits (비트 개수)" ariaLabel="Bits 도움말"><BitsHelp /></ThWithHelp>
            <ThWithHelp label="Endian" title="Endian (바이트 순서)" ariaLabel="Endian 도움말"><EndianHelp /></ThWithHelp>
            {showUnit && (
              <ThWithHelp label="Unit" title="Unit (표시 단위)" ariaLabel="Unit 도움말"><UnitHelp /></ThWithHelp>
            )}
            {mode === 'payload' && (
              <ThWithHelp label="Flag" title="Flag (LCP 분기)" ariaLabel="Flag 도움말"><FlagHelp /></ThWithHelp>
            )}
            <th className="col-decoration-header">
              <span className="th-label-with-info">
                Decoration
                <ColumnHelp title="Decoration (표시 변환)" ariaLabel="Decoration 도움말"><DecorationHelp /></ColumnHelp>
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
                  title="바이트 크기 (인덱스 아님)"
                />
              </td>
              <td>
                {(f.bit_length ?? 0) > 0 ? (
                  <input
                    className="field-num"
                    type="number"
                    min={0}
                    max={7}
                    value={f.bit_offset ?? ''}
                    placeholder="auto"
                    onChange={e => {
                      const v = e.target.value;
                      update(i, { bit_offset: v === '' ? undefined : parseInt(v, 10) || 0 });
                    }}
                  />
                ) : (
                  <span className="field-na" title="Bits &gt; 0 일 때만 사용">—</span>
                )}
              </td>
              <td>
                <input
                  className="field-num"
                  type="number"
                  min={0}
                  max={64}
                  value={f.bit_length ?? 0}
                  onChange={e => update(i, { bit_length: parseInt(e.target.value, 10) || 0 })}
                  title="0=바이트 필드, 1+=비트 필드"
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
