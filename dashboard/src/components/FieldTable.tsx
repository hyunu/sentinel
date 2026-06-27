import { useState, useEffect, useRef, useCallback, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
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

function ColumnHelp({
  title,
  ariaLabel,
  children,
  popoverClass,
  width = POPOVER_W,
}: {
  title: string;
  ariaLabel: string;
  children: ReactNode;
  popoverClass?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const clampPosition = useCallback((left: number, top: number) => {
    const margin = 8;
    let x = left;
    let y = top;
    if (x + width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - width - margin);
    }
    if (x < margin) x = margin;
    const maxH = 480;
    if (y + maxH > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - maxH - margin);
    }
    if (y < margin) y = margin;
    return { left: x, top: y };
  }, [width]);

  const positionFromMouse = useCallback((clientX: number, clientY: number) => {
    const gap = 8;
    return clampPosition(clientX + gap, clientY - 8);
  }, [clampPosition]);

  const positionFromButton = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const gap = 8;
    setPos(clampPosition(rect.right + gap, rect.top));
  }, [clampPosition]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => positionFromButton();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, positionFromButton]);

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

  const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    setPos(positionFromMouse(e.clientX, e.clientY));
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="info-icon-btn"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={handleClick}
      >
        i
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className={`decoration-help-popover${popoverClass ? ` ${popoverClass}` : ''}`}
          role="dialog"
          aria-label={ariaLabel}
          style={{ top: pos.top, left: pos.left, width }}
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

function ThWithHelp({
  label,
  ariaLabel,
  title,
  children,
  popoverClass,
  popoverWidth,
}: {
  label: string;
  ariaLabel: string;
  title: string;
  children: ReactNode;
  popoverClass?: string;
  popoverWidth?: number;
}) {
  return (
    <th>
      <span className="th-label-with-info">
        {label}
        <ColumnHelp title={title} ariaLabel={ariaLabel} popoverClass={popoverClass} width={popoverWidth}>
          {children}
        </ColumnHelp>
      </span>
    </th>
  );
}

const BASE_TYPE_HELP: { term: string; desc: ReactNode }[] = [
  { term: 'uint8', desc: '1바이트 부호 없는 정수 (0–255). Len=1' },
  { term: 'uint16', desc: '2바이트 부호 없는 정수. Len=2, Endian(LE/BE) 적용' },
  { term: 'uint32', desc: '4바이트 부호 없는 정수. Len=4, Endian 적용' },
  { term: 'int8', desc: '1바이트 부호 있는 정수 (-128–127). Len=1' },
  { term: 'int16', desc: '2바이트 부호 있는 정수. Len=2, Endian 적용' },
  { term: 'float', desc: 'IEEE754 float32. Len=4, Endian 적용 (Temperature 등)' },
  { term: 'ascii', desc: 'Len 바이트를 ASCII 문자열로. 끝의 null(0x00) 제거' },
  { term: 'hex', desc: 'Len 바이트를 대문자 hex 문자열로 (예: AABBCC)' },
  { term: 'raw', desc: '바이너리 blob. Len=0 + repeat=until_end 이면 남은 payload 전체를 hex로' },
];

const COMPOSITOR_TYPE_HELP: { term: string; desc: ReactNode }[] = [
  {
    term: 'struct',
    desc: '하위 fields를 중첩 객체로 파싱. 결과가 트리(map)로 저장됨',
  },
  {
    term: 'dispatch',
    desc: (
      <>
        <strong>dispatch_on</strong> 필드 값으로 하위 스키마 분기.
        dispatch_variants: &#123; &quot;01&quot;: [fields…] &#125; · default_fields 로 fallback
      </>
    ),
  },
  {
    term: 'tagged_repeat',
    desc: (
      <>
        <code>flag | len | body</code> 블록을 payload 끝까지 반복.
        fields[] 각 항목의 Flag(FA/FB/…)로 body 스키마 선택 — 블록 종류 N개 확장 가능
      </>
    ),
  },
  {
    term: 'tagged_block',
    desc: (
      <>
        <code>flag | len | body</code> 한 덩어리. CD result 등 단일 분기에 사용.
        Flag(FD/FE)별 fields 로 body 파싱
      </>
    ),
  },
];

const LEGACY_TYPE_HELP: { term: string; desc: ReactNode }[] = [
  {
    term: 'function_args',
    desc: 'tagged_repeat 로 대체 권장. FA|len|body 반복 (하위 Fields[0]=FA 템플릿)',
  },
  {
    term: 'func_result',
    desc: 'tagged_block 로 대체 권장. flag|len|body 단일 블록',
  },
  {
    term: 'dynamic',
    desc: 'dispatch_on + dispatch_variants 로 대체 권장. 미설정 시 hex dump',
  },
];

function TypeHelp({ mode }: { mode: 'raw' | 'payload' }) {
  return (
    <>
      <p className="decoration-help-section">기본 타입</p>
      <HelpList items={BASE_TYPE_HELP} />
      {mode === 'payload' && (
        <>
          <p className="decoration-help-section">Combinators (범용)</p>
          <HelpList items={COMPOSITOR_TYPE_HELP} />
          <p className="decoration-help-section">Legacy (호환)</p>
          <HelpList items={LEGACY_TYPE_HELP} />
        </>
      )}
    </>
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
      { term: '매칭', desc: 'tagged_repeat / tagged_block 파싱 시 Flag 와 일치하는 variant 행 적용' },
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
            <ThWithHelp
              label="Type"
              title="Type (데이터 타입)"
              ariaLabel="Type 도움말"
              popoverClass="decoration-help-popover--scroll"
              popoverWidth={400}
            >
              <TypeHelp mode={mode} />
            </ThWithHelp>
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
