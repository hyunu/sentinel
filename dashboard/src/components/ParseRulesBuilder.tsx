import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { BitDef, JsonFieldRule, JsonRuleDocument } from '../types/ruleparser';
import {
  TYPE_GROUPS,
  addSwitchCase,
  defaultsForType,
  displayToRef,
  duplicateRule,
  emptyField,
  emptyInnerType,
  fieldHasNestedChildren,
  fieldNeedsEndian,
  fieldNeedsSize,
  getTypeCategory,
  moveRule,
  nestedChildSummary,
  refToDisplay,
  removeSwitchCase,
  setSwitchCase,
  switchCaseEntries,
} from '../lib/ruleBuilderUtils';
import '../styles/ruleBuilder.css';

type CollapseCtx = {
  bulkTick: number;
  bulkOpen: boolean | null;
  triggerAll: (open: boolean) => void;
};

const CollapseContext = createContext<CollapseCtx | null>(null);

function useCollapse(defaultOpen = false) {
  const [open, setOpen] = useState(defaultOpen);
  return { open, setOpen };
}

function CollapseProvider({ children }: { children: ReactNode }) {
  const [bulkTick, setBulkTick] = useState(0);
  const [bulkOpen, setBulkOpen] = useState<boolean | null>(null);

  const ctx = useMemo<CollapseCtx>(() => ({
    bulkTick,
    bulkOpen,
    triggerAll: (open: boolean) => {
      setBulkOpen(open);
      setBulkTick(t => t + 1);
    },
  }), [bulkTick, bulkOpen]);

  return <CollapseContext.Provider value={ctx}>{children}</CollapseContext.Provider>;
}

function TypePill({ type }: { type: string }) {
  return <span className={`rb-type-pill rb-type-pill--${getTypeCategory(type)}`}>{type}</span>;
}

function TypeSelect({ value, onChange, compact }: { value: string; onChange: (type: string) => void; compact?: boolean }) {
  return (
    <select className={compact ? 'rb-type rb-type--sm' : 'rb-type'} value={value} onChange={e => onChange(e.target.value)}>
      {TYPE_GROUPS.map(g => (
        <optgroup key={g.label} label={g.label}>
          {g.types.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function InlineRef({
  value,
  onChange,
  fieldPlaceholder = 'len',
  exprPlaceholder = 'len - 2',
}: {
  value?: string | { expr: string };
  onChange: (v: string | { expr: string } | undefined) => void;
  fieldPlaceholder?: string;
  exprPlaceholder?: string;
}) {
  const { mode, value: text } = refToDisplay(value);
  return (
    <div className="rb-inline-ref">
      <select
        className="rb-inline-ref-mode"
        value={mode}
        title="참조 방식"
        onChange={e => onChange(displayToRef(e.target.value as 'field' | 'expr', text))}
      >
        <option value="field">필드</option>
        <option value="expr">식</option>
      </select>
      <input
        className="rb-inline-ref-val mono"
        value={text}
        placeholder={mode === 'field' ? fieldPlaceholder : exprPlaceholder}
        onChange={e => onChange(displayToRef(mode, e.target.value))}
      />
    </div>
  );
}

function InlineExtras({
  rule,
  onChange,
}: {
  rule: JsonFieldRule;
  onChange: (patch: Partial<JsonFieldRule>) => void;
}) {
  switch (rule.type) {
    case 'VarBytes':
    case 'VarString':
      return <InlineRef value={rule.length_from} onChange={v => onChange({ length_from: v })} />;
    case 'Until':
      return (
        <input
          className="rb-inline-input mono"
          value={(rule.delimiter ?? []).join(', ')}
          title="구분자 (10진수)"
          placeholder="187"
          onChange={e => {
            const delimiter = e.target.value
              .split(',')
              .map(s => parseInt(s.trim(), 10))
              .filter(n => !Number.isNaN(n));
            onChange({ delimiter });
          }}
        />
      );
    case 'Validate': {
      const inner = rule.inner ?? emptyInnerType();
      return (
        <>
          <TypeSelect compact value={inner.type} onChange={t => onChange({ inner: defaultsForType(t, inner) })} />
          <input
            className="rb-inline-input rb-inline-grow mono"
            value={rule.validate_expr ?? ''}
            placeholder="value == 0xAA"
            onChange={e => onChange({ validate_expr: e.target.value })}
          />
        </>
      );
    }
    case 'Transform': {
      const inner = rule.inner ?? emptyInnerType();
      return (
        <>
          <TypeSelect compact value={inner.type} onChange={t => onChange({ inner: defaultsForType(t, inner) })} />
          <input
            className="rb-inline-input rb-inline-grow mono"
            value={rule.transform_expr ?? ''}
            placeholder="value / 10"
            onChange={e => onChange({ transform_expr: e.target.value })}
          />
        </>
      );
    }
    case 'Computed':
      return (
        <input
          className="rb-inline-input rb-inline-grow mono"
          value={rule.expr ?? ''}
          placeholder="expr"
          onChange={e => onChange({ expr: e.target.value })}
        />
      );
    case 'Switch':
      return (
        <div className="rb-inline-labeled">
          <span className="rb-inline-tag">key</span>
          <input
            className="rb-inline-input"
            value={rule.key_from ?? ''}
            placeholder="fid"
            onChange={e => onChange({ key_from: e.target.value })}
          />
        </div>
      );
    case 'RepeatCount':
      return (
        <div className="rb-inline-labeled">
          <span className="rb-inline-tag">×</span>
          <InlineRef value={rule.count_from} onChange={v => onChange({ count_from: v })} fieldPlaceholder="count" />
        </div>
      );
    case 'Array': {
      const item = rule.item_type ?? emptyInnerType();
      return (
        <>
          <div className="rb-inline-labeled">
            <span className="rb-inline-tag">×</span>
            <InlineRef value={rule.count_from} onChange={v => onChange({ count_from: v })} fieldPlaceholder="count" />
          </div>
          <TypeSelect compact value={item.type} onChange={t => onChange({ item_type: defaultsForType(t, item) })} />
        </>
      );
    }
    case 'RepeatUntil':
      return (
        <input
          className="rb-inline-input rb-inline-grow mono"
          value={rule.predicate?.expr ?? ''}
          placeholder="종료 조건"
          onChange={e => onChange({ predicate: { expr: e.target.value } })}
        />
      );
    case 'Optional':
    case 'If':
      return (
        <input
          className="rb-inline-input rb-inline-grow mono"
          value={rule.predicate?.expr ?? ''}
          placeholder="조건식"
          onChange={e => onChange({ predicate: { expr: e.target.value } })}
        />
      );
    case 'LengthPrefixed': {
      const len = rule.len_type ?? emptyInnerType();
      return <TypeSelect compact value={len.type} onChange={t => onChange({ len_type: defaultsForType(t, len) })} />;
    }
    default:
      return (
        <>
          {fieldNeedsSize(rule) && (
            <input
              className="rb-inline-input rb-inline-num"
              type="number"
              min={1}
              title="크기 (bytes)"
              value={rule.size ?? 1}
              onChange={e => onChange({ size: parseInt(e.target.value, 10) || 1 })}
            />
          )}
          {fieldNeedsEndian(rule) && (
            <select
              className="rb-inline-input rb-inline-endian"
              value={rule.endian || 'big'}
              onChange={e => onChange({ endian: e.target.value })}
            >
              <option value="big">BE</option>
              <option value="little">LE</option>
            </select>
          )}
        </>
      );
  }
}

function CollapsiblePanel({
  title,
  summary,
  defaultOpen = false,
  actions,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const collapse = useCollapse(defaultOpen);
  const ctx = useContext(CollapseContext);

  useEffect(() => {
    if (ctx?.bulkOpen != null) collapse.setOpen(ctx.bulkOpen);
  }, [ctx?.bulkTick, ctx?.bulkOpen, collapse.setOpen]);

  const open = collapse.open;
  return (
    <div className={`rb-panel${open ? ' is-open' : ' is-collapsed'}`}>
      <div className="rb-panel-head">
        <button type="button" className="rb-chevron-btn" onClick={() => collapse.setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'}
        </button>
        <button type="button" className="rb-panel-title-btn" onClick={() => collapse.setOpen(!open)}>
          <span className="rb-panel-title">{title}</span>
          {!open && summary && <span className="rb-panel-summary">{summary}</span>}
        </button>
        {actions && <div className="rb-panel-actions">{actions}</div>}
      </div>
      {open && <div className="rb-panel-body">{children}</div>}
    </div>
  );
}

function BitsSubRows({ bits, onChange }: { bits: BitDef[]; onChange: (bits: BitDef[]) => void }) {
  const update = (i: number, patch: Partial<BitDef>) => {
    onChange(bits.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };
  const remove = (i: number) => {
    if (bits.length <= 1) {
      onChange([{ name: 'flag', bits: 8 }]);
      return;
    }
    onChange(bits.filter((_, idx) => idx !== i));
  };
  return (
    <div className="rb-bits-list">
      <div className="rb-bits-head">
        <span>이름</span>
        <span>비트 수</span>
        <span />
      </div>
      {bits.map((b, i) => (
        <div key={i} className="rb-bits-row">
          <input
            className="rb-bits-name"
            value={b.name}
            placeholder="retry_count"
            onChange={e => update(i, { name: e.target.value })}
          />
          <div className="rb-bits-num">
            <input
              type="number"
              min={1}
              max={64}
              value={b.bits}
              onChange={e => update(i, { bits: parseInt(e.target.value, 10) || 1 })}
            />
            <span className="rb-bits-unit">bits</span>
          </div>
          <button type="button" className="rb-icon-btn rb-icon-btn--danger" onClick={() => remove(i)} aria-label="삭제">×</button>
        </div>
      ))}
      <button type="button" className="rb-add-sub" onClick={() => onChange([...bits, { name: '', bits: 1 }])}>
        + 비트 필드
      </button>
    </div>
  );
}

function NestedChildren({
  rule,
  onChange,
  depth,
  pathPrefix,
}: {
  rule: JsonFieldRule;
  onChange: (patch: Partial<JsonFieldRule>) => void;
  depth: number;
  pathPrefix: string;
}) {
  switch (rule.type) {
    case 'Bits':
      return (
        <BitsSubRows
          bits={rule.bits ?? [{ name: 'flag', bits: 8 }]}
          onChange={bits => onChange({ bits })}
        />
      );
    case 'RepeatCount':
    case 'RepeatUntilEnd':
    case 'RepeatUntil':
      return (
        <FieldRulesEditor
          rules={rule.item_rules?.length ? rule.item_rules : [emptyField('item')]}
          onChange={item_rules => onChange({ item_rules })}
          depth={depth + 1}
          pathPrefix={`${pathPrefix}.items`}
        />
      );
    case 'Switch':
      return (
        <>
          {switchCaseEntries(rule).map(({ key, rules: caseRules }) => (
            <CollapsiblePanel
              key={key}
              title={`Case ${key}`}
              summary={`${caseRules.length} 필드`}
              defaultOpen={depth < 1}
              actions={
                <button
                  type="button"
                  className="rb-icon-btn rb-icon-btn--danger"
                  onClick={() => onChange({ cases: removeSwitchCase(rule, key).cases })}
                  aria-label="케이스 삭제"
                >
                  ×
                </button>
              }
            >
              <div className="rb-case-key-row">
                <span className="rb-inline-tag">키</span>
                <input
                  className="rb-inline-input rb-inline-num mono"
                  value={key}
                  onChange={e => onChange({ cases: setSwitchCase(rule, key, e.target.value, caseRules).cases })}
                  placeholder="207"
                />
              </div>
              <FieldRulesEditor
                rules={caseRules.length ? caseRules : [emptyField()]}
                onChange={next => onChange({ cases: setSwitchCase(rule, key, key, next).cases })}
                depth={depth + 1}
                pathPrefix={`${pathPrefix}.case.${key}`}
              />
            </CollapsiblePanel>
          ))}
          <button type="button" className="rb-add-sub" onClick={() => onChange(addSwitchCase(rule))}>
            + 케이스 추가
          </button>
          {(rule.default?.length ?? 0) > 0 ? (
            <CollapsiblePanel
              title="Default (fallback)"
              summary={`${rule.default!.length} 필드`}
            >
              <FieldRulesEditor
                rules={rule.default!}
                onChange={defaultRules => onChange({ default: defaultRules.length ? defaultRules : undefined })}
                depth={depth + 1}
                pathPrefix={`${pathPrefix}.default`}
              />
            </CollapsiblePanel>
          ) : (
            <button
              type="button"
              className="rb-add-sub rb-add-sub--ghost"
              onClick={() => onChange({ default: [emptyField()] })}
            >
              + default 추가
            </button>
          )}
        </>
      );
    case 'Optional':
      return (
        <FieldRulesEditor
          rules={rule.rules?.length ? rule.rules : [emptyField()]}
          onChange={rules => onChange({ rules })}
          depth={depth + 1}
          pathPrefix={`${pathPrefix}.rules`}
        />
      );
    case 'If':
      return (
        <>
          <CollapsiblePanel
            title="Then"
            summary={`${rule.then?.length ?? 0} 필드`}
            defaultOpen
          >
            <FieldRulesEditor
              rules={rule.then?.length ? rule.then : [emptyField()]}
              onChange={then => onChange({ then })}
              depth={depth + 1}
              pathPrefix={`${pathPrefix}.then`}
            />
          </CollapsiblePanel>
          {(rule.else?.length ?? 0) > 0 ? (
            <CollapsiblePanel
              title="Else"
              summary={`${rule.else!.length} 필드`}
            >
              <FieldRulesEditor
                rules={rule.else!}
                onChange={elseRules => onChange({ else: elseRules.length ? elseRules : undefined })}
                depth={depth + 1}
                pathPrefix={`${pathPrefix}.else`}
              />
            </CollapsiblePanel>
          ) : (
            <button
              type="button"
              className="rb-add-sub rb-add-sub--ghost"
              onClick={() => onChange({ else: [emptyField()] })}
            >
              + else 추가
            </button>
          )}
        </>
      );
    case 'Struct':
    case 'Nested':
      return (
        <FieldRulesEditor
          rules={rule.fields?.length ? rule.fields : [emptyField()]}
          onChange={fields => onChange({ fields })}
          depth={depth + 1}
          pathPrefix={`${pathPrefix}.fields`}
        />
      );
    case 'LengthPrefixed':
      return rule.item_rules?.length ? (
        <FieldRulesEditor
          rules={rule.item_rules}
          onChange={item_rules => onChange({ item_rules })}
          depth={depth + 1}
          pathPrefix={`${pathPrefix}.payload`}
        />
      ) : (
        <button
          type="button"
          className="rb-add-sub rb-add-sub--ghost"
          onClick={() => onChange({ item_rules: [emptyField()] })}
        >
          + payload 필드
        </button>
      );
    default:
      return null;
  }
}

function FieldRowActions({
  index,
  total,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
}: {
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rb-actions">
      <button type="button" className="rb-icon-btn" disabled={index === 0} onClick={onMoveUp} title="위로" aria-label="위로">↑</button>
      <button type="button" className="rb-icon-btn" disabled={index === total - 1} onClick={onMoveDown} title="아래로" aria-label="아래로">↓</button>
      <button type="button" className="rb-icon-btn" onClick={onDuplicate} title="복제" aria-label="복제">⎘</button>
      <button type="button" className="rb-icon-btn rb-icon-btn--danger" onClick={onRemove} title="삭제" aria-label="삭제">×</button>
    </div>
  );
}

type FieldRulesEditorProps = {
  rules: JsonFieldRule[];
  onChange: (rules: JsonFieldRule[]) => void;
  depth?: number;
  label?: string;
  pathPrefix?: string;
};

function FieldRulesEditor({ rules, onChange, depth = 0, label, pathPrefix = 'root' }: FieldRulesEditorProps) {
  const collapseCtx = useContext(CollapseContext);

  const update = (i: number, patch: Partial<JsonFieldRule>) => {
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const updateType = (i: number, newType: string) => {
    onChange(rules.map((r, idx) => (idx === i ? defaultsForType(newType, r) : r)));
  };

  const remove = (i: number) => {
    if (rules.length <= 1 && depth === 0) {
      onChange([emptyField()]);
      return;
    }
    onChange(rules.filter((_, idx) => idx !== i));
  };

  const wrapperClass = depth > 0 ? `rb-nested depth-${Math.min(depth, 4)}` : 'rb';

  return (
    <div className={wrapperClass}>
      {label && depth > 0 && <p className="rb-nest-label">{label}</p>}

      {depth === 0 && (
        <div className="rb-list-toolbar">
          <span className="rb-list-count">패킷 필드 <strong>{rules.length}</strong></span>
          {collapseCtx && (
            <div className="rb-list-toolbar-btns">
              <button type="button" className="rb-text-btn" onClick={() => collapseCtx.triggerAll(true)}>모두 펼치기</button>
              <button type="button" className="rb-text-btn" onClick={() => collapseCtx.triggerAll(false)}>모두 접기</button>
            </div>
          )}
        </div>
      )}

      {depth === 0 && (
        <div className="rb-table-head">
          <span />
          <span>#</span>
          <span>이름</span>
          <span>타입</span>
          <span>옵션</span>
          <span />
        </div>
      )}

      <div className="rb-fields">
        {rules.length === 0 ? (
          <div className="rb-empty">필드가 없습니다.</div>
        ) : rules.map((rule, i) => (
          <FieldBlock
            key={`${pathPrefix}-${i}-${rule.name}`}
            rule={rule}
            index={i}
            total={rules.length}
            depth={depth}
            fieldKey={`${pathPrefix}.${i}`}
            onChange={patch => update(i, patch)}
            onChangeType={t => updateType(i, t)}
            onMoveUp={() => onChange(moveRule(rules, i, -1))}
            onMoveDown={() => onChange(moveRule(rules, i, 1))}
            onDuplicate={() => onChange(duplicateRule(rules, i))}
            onRemove={() => remove(i)}
          />
        ))}
      </div>

      <button type="button" className="rb-add" onClick={() => onChange([...rules, emptyField()])}>
        + 필드 추가
      </button>
    </div>
  );
}

function FieldBlock({
  rule,
  index,
  total,
  depth,
  fieldKey,
  onChange,
  onChangeType,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
}: {
  rule: JsonFieldRule;
  index: number;
  total: number;
  depth: number;
  fieldKey: string;
  onChange: (patch: Partial<JsonFieldRule>) => void;
  onChangeType: (type: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const hasNested = fieldHasNestedChildren(rule);
  const defaultOpen = depth === 0 && !['Switch', 'RepeatCount'].includes(rule.type);
  const collapse = useCollapse(defaultOpen);
  const ctx = useContext(CollapseContext);

  useEffect(() => {
    if (ctx?.bulkOpen != null) collapse.setOpen(ctx.bulkOpen);
  }, [ctx?.bulkTick, ctx?.bulkOpen, collapse.setOpen]);

  const open = collapse.open;
  const summary = hasNested ? nestedChildSummary(rule) : '';

  return (
    <div className={`rb-field-card${hasNested ? ' has-children' : ''}${hasNested && open ? ' is-expanded' : ''}${hasNested && !open ? ' is-collapsed' : ''}`}>
      <div className="rb-row">
        {hasNested ? (
          <button type="button" className="rb-chevron-btn" onClick={() => collapse.setOpen(!open)} aria-expanded={open} aria-label={open ? '접기' : '펼치기'}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="rb-chevron-spacer" />
        )}
        <span className="rb-index">{index + 1}</span>
        <input
          className="rb-name"
          value={rule.name}
          placeholder="필드명"
          onChange={e => onChange({ name: e.target.value })}
        />
        <div className="rb-type-wrap">
          <TypePill type={rule.type} />
          <TypeSelect value={rule.type} onChange={onChangeType} />
        </div>
        <div className="rb-inline-extras">
          <InlineExtras rule={rule} onChange={onChange} />
          {hasNested && !open && summary && (
            <span className="rb-nested-badge">{summary}</span>
          )}
        </div>
        <FieldRowActions
          index={index}
          total={total}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />
      </div>
      {hasNested && open && (
        <div className="rb-children">
          <NestedChildren rule={rule} onChange={onChange} depth={depth} pathPrefix={fieldKey} />
        </div>
      )}
    </div>
  );
}

type ParseRulesBuilderProps = {
  document: JsonRuleDocument;
  onChange: (doc: JsonRuleDocument) => void;
};

export default function ParseRulesBuilder({ document, onChange }: ParseRulesBuilderProps) {
  const meta = document._meta ?? {};
  const hasMeta = Boolean(meta.name || meta.version || meta.frame || meta.description);

  const updateMeta = (key: string, value: string) => {
    const next = { ...meta, [key]: value || undefined };
    Object.keys(next).forEach(k => {
      if (next[k] === undefined || next[k] === '') delete next[k];
    });
    onChange({
      ...document,
      _meta: Object.keys(next).length ? next : undefined,
      fields: document.fields,
    });
  };

  return (
    <CollapseProvider>
      <div className="parse-rules-builder">
        <details className="rb-meta" open={hasMeta}>
          <summary>문서 메타데이터 (선택)</summary>
          <div className="rb-meta-row">
            <input value={String(meta.name ?? '')} onChange={e => updateMeta('name', e.target.value)} placeholder="규칙 이름" />
            <input value={String(meta.version ?? '')} onChange={e => updateMeta('version', e.target.value)} placeholder="버전" className="rb-meta-short" />
            <input className="mono rb-meta-grow" value={String(meta.frame ?? '')} onChange={e => updateMeta('frame', e.target.value)} placeholder="프레임 구조" />
            <input className="rb-meta-grow" value={String(meta.description ?? '')} onChange={e => updateMeta('description', e.target.value)} placeholder="설명" />
          </div>
        </details>

        <FieldRulesEditor
          rules={document.fields?.length ? document.fields : [emptyField()]}
          onChange={fields => onChange({ ...document, fields })}
          depth={0}
          pathPrefix="fields"
        />
      </div>
    </CollapseProvider>
  );
}

export { cloneRules } from '../lib/ruleBuilderUtils';
