import type { ExprDef, JsonFieldRule, JsonRuleDocument } from '../types/ruleparser';

export const PRIMITIVE_TYPES = ['U8', 'U16', 'U32', 'I8', 'I16', 'I32', 'Float', 'Bool'] as const;
export const FIXED_TYPES = ['Fixed', 'String', 'Padding'] as const;
export const VARIABLE_TYPES = ['VarBytes', 'VarString', 'Until', 'UntilEnd'] as const;
export const COMPOSITE_TYPES = [
  'RepeatCount',
  'RepeatUntilEnd',
  'RepeatUntil',
  'Switch',
  'Validate',
  'Optional',
  'If',
  'Bits',
  'Struct',
  'Nested',
  'Array',
  'LengthPrefixed',
  'Computed',
  'Transform',
] as const;

export const ALL_FIELD_TYPES = [
  ...PRIMITIVE_TYPES,
  ...FIXED_TYPES,
  ...VARIABLE_TYPES,
  ...COMPOSITE_TYPES,
] as const;

export const TYPE_GROUPS: { label: string; types: readonly string[] }[] = [
  { label: 'Integer / Float', types: PRIMITIVE_TYPES },
  { label: 'Fixed length', types: FIXED_TYPES },
  { label: 'Variable length', types: VARIABLE_TYPES },
  { label: 'Structure / Control', types: COMPOSITE_TYPES },
];

export type TypeCategory = 'primitive' | 'fixed' | 'variable' | 'composite';

export function getTypeCategory(type: string): TypeCategory {
  if (PRIMITIVE_TYPES.includes(type as typeof PRIMITIVE_TYPES[number])) return 'primitive';
  if (FIXED_TYPES.includes(type as typeof FIXED_TYPES[number])) return 'fixed';
  if (VARIABLE_TYPES.includes(type as typeof VARIABLE_TYPES[number])) return 'variable';
  return 'composite';
}

export function fieldSummary(rule: JsonFieldRule): string {
  switch (rule.type) {
    case 'Switch':
      return rule.key_from ? `key: ${rule.key_from}` : 'Switch';
    case 'RepeatCount':
      return typeof rule.count_from === 'string'
        ? `repeat × ${rule.count_from}`
        : rule.count_from && typeof rule.count_from === 'object'
          ? `repeat × ${rule.count_from.expr}`
          : 'RepeatCount';
    case 'Validate':
      return rule.validate_expr ? rule.validate_expr.slice(0, 32) : 'Validate';
    case 'VarBytes':
    case 'VarString':
      return rule.length_from
        ? typeof rule.length_from === 'string'
          ? `len ← ${rule.length_from}`
          : `len ← ${rule.length_from.expr}`
        : rule.type;
    case 'Bits':
      return `${rule.bits?.length ?? 0} bit fields`;
    case 'Struct':
    case 'Nested':
      return `${rule.fields?.length ?? 0} nested fields`;
    default:
      return rule.type;
  }
}

const ENDIAN_TYPES = new Set(['U16', 'U32', 'I16', 'I32', 'Float']);
const SIZE_TYPES = new Set(['Fixed', 'String', 'Padding']);

export function emptyField(name = 'field'): JsonFieldRule {
  return { name, type: 'U8' };
}

/** Minimal parse_rules for a new protocol (not the LCP/OSP template). */
export function blankParseRules(): JsonRuleDocument {
  return { fields: [emptyField()] };
}

/** Coalesce null/empty API payloads into a usable document for the builder. */
export function normalizeParseRulesDocument(raw?: JsonRuleDocument | null): JsonRuleDocument {
  if (!raw) return blankParseRules();
  if (raw.fields?.length) return raw;
  return { ...raw, fields: [emptyField()] };
}

export function emptyInnerType(type = 'U8'): JsonFieldRule {
  return { name: '_inner', type };
}

export function emptyDocument(): JsonRuleDocument {
  return { fields: [emptyField()] };
}

export function cloneRules(rules: JsonFieldRule[]): JsonFieldRule[] {
  return structuredClone(rules);
}

export function cloneDocument(doc: JsonRuleDocument): JsonRuleDocument {
  return structuredClone(doc);
}

const NESTED_CHILD_TYPES = new Set([
  'RepeatCount',
  'RepeatUntilEnd',
  'RepeatUntil',
  'Switch',
  'Optional',
  'If',
  'Struct',
  'Nested',
  'Bits',
]);

/** 하위 필드/케이스 목록이 있는 타입 */
export function fieldHasNestedChildren(rule: JsonFieldRule): boolean {
  if (NESTED_CHILD_TYPES.has(rule.type)) return true;
  if (rule.type === 'LengthPrefixed' && (rule.item_rules?.length ?? 0) > 0) return true;
  return false;
}

/** 접힌 상태에서 보여줄 하위 요약 */
export function nestedChildSummary(rule: JsonFieldRule): string {
  switch (rule.type) {
    case 'Switch': {
      const n = Object.keys(rule.cases ?? {}).length;
      const d = rule.default?.length ? ' · default' : '';
      return `${n} case${n !== 1 ? 's' : ''}${d}`;
    }
    case 'RepeatCount':
    case 'RepeatUntilEnd':
    case 'RepeatUntil':
      return `${rule.item_rules?.length ?? 0} items`;
    case 'Bits':
      return `${rule.bits?.length ?? 0} bit`;
    case 'Optional':
      return `${rule.rules?.length ?? 0} fields`;
    case 'If': {
      const t = rule.then?.length ?? 0;
      const e = rule.else?.length ?? 0;
      return `then ${t}${e ? ` · else ${e}` : ''}`;
    }
    case 'Struct':
    case 'Nested':
      return `${rule.fields?.length ?? 0} fields`;
    case 'LengthPrefixed':
      return `${rule.item_rules?.length ?? 0} payload`;
    default:
      return 'nested';
  }
}

/** 접기/펼치기 없이 한 줄에 표시 가능한 추가 속성 */
export function fieldHasInlineExtras(rule: JsonFieldRule): boolean {
  switch (rule.type) {
    case 'VarBytes':
    case 'VarString':
    case 'Until':
    case 'Validate':
    case 'Transform':
    case 'Computed':
    case 'Switch':
    case 'RepeatCount':
    case 'RepeatUntil':
    case 'Array':
    case 'Optional':
    case 'If':
    case 'LengthPrefixed':
      return true;
    default:
      return fieldNeedsSize(rule) || fieldNeedsEndian(rule);
  }
}

/** @deprecated use fieldHasNestedChildren / fieldHasInlineExtras */
export function fieldNeedsPanel(rule: JsonFieldRule): boolean {
  return fieldHasNestedChildren(rule);
}

export function fieldNeedsEndian(rule: JsonFieldRule): boolean {
  return ENDIAN_TYPES.has(rule.type);
}

export function fieldNeedsSize(rule: JsonFieldRule): boolean {
  return SIZE_TYPES.has(rule.type);
}

export function defaultsForType(type: string, prev?: JsonFieldRule): JsonFieldRule {
  const name = prev?.name || 'field';
  const base: JsonFieldRule = { name, type };

  switch (type) {
    case 'U16':
    case 'U32':
    case 'I16':
    case 'I32':
    case 'Float':
      return { ...base, endian: prev?.endian || 'big' };
    case 'Fixed':
    case 'String':
    case 'Padding':
      return { ...base, size: prev?.size ?? 1 };
    case 'VarBytes':
    case 'VarString':
      return { ...base, length_from: prev?.length_from ?? 'len' };
    case 'Until':
      return { ...base, delimiter: prev?.delimiter ?? [0] };
    case 'RepeatCount':
    case 'RepeatUntilEnd':
    case 'RepeatUntil':
      return {
        ...base,
        count_from: prev?.count_from,
        item_rules: prev?.item_rules?.length ? cloneRules(prev.item_rules) : [emptyField('item')],
        predicate: prev?.predicate,
      };
    case 'Switch':
      return {
        ...base,
        key_from: prev?.key_from ?? 'fid',
        cases: prev?.cases ? structuredClone(prev.cases) : { '0': [emptyField()] },
        default: prev?.default ? cloneRules(prev.default) : undefined,
      };
    case 'Validate':
      return {
        ...base,
        inner: prev?.inner ?? emptyInnerType('U8'),
        validate_expr: prev?.validate_expr ?? 'value == 0',
      };
    case 'Transform':
      return {
        ...base,
        inner: prev?.inner ?? emptyInnerType('U8'),
        transform_expr: prev?.transform_expr ?? 'value',
      };
    case 'Optional':
    case 'If':
      return {
        ...base,
        predicate: prev?.predicate ?? { expr: 'true' },
        rules: prev?.rules ? cloneRules(prev.rules) : undefined,
        then: prev?.then ? cloneRules(prev.then) : [emptyField()],
        else: prev?.else ? cloneRules(prev.else) : undefined,
      };
    case 'Bits':
      return {
        ...base,
        bits: prev?.bits?.length ? structuredClone(prev.bits) : [{ name: 'flag', bits: 8 }],
      };
    case 'Struct':
    case 'Nested':
      return {
        ...base,
        fields: prev?.fields?.length ? cloneRules(prev.fields) : [emptyField()],
      };
    case 'Array':
      return {
        ...base,
        count_from: prev?.count_from ?? 'count',
        item_type: prev?.item_type ?? emptyInnerType('U8'),
      };
    case 'LengthPrefixed':
      return {
        ...base,
        len_type: prev?.len_type ?? emptyInnerType('U8'),
        item_rules: prev?.item_rules,
      };
    case 'Computed':
      return { ...base, expr: prev?.expr ?? '0' };
    default:
      return base;
  }
}

export type RefMode = 'field' | 'expr';

export function refToDisplay(ref?: string | ExprDef): { mode: RefMode; value: string } {
  if (!ref) return { mode: 'field', value: '' };
  if (typeof ref === 'string') return { mode: 'field', value: ref };
  return { mode: 'expr', value: ref.expr ?? '' };
}

export function displayToRef(mode: RefMode, value: string): string | ExprDef | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return mode === 'expr' ? { expr: trimmed } : trimmed;
}

export function switchCaseEntries(rule: JsonFieldRule): { key: string; rules: JsonFieldRule[] }[] {
  if (!rule.cases) return [];
  return Object.entries(rule.cases).map(([key, rules]) => ({ key, rules }));
}

export function setSwitchCase(rule: JsonFieldRule, oldKey: string, newKey: string, rules: JsonFieldRule[]): JsonFieldRule {
  const cases = { ...(rule.cases ?? {}) };
  if (oldKey !== newKey && oldKey in cases) delete cases[oldKey];
  cases[newKey] = rules;
  return { ...rule, cases };
}

export function addSwitchCase(rule: JsonFieldRule): JsonFieldRule {
  const cases = { ...(rule.cases ?? {}) };
  let n = 0;
  while (cases[String(n)]) n += 1;
  cases[String(n)] = [emptyField()];
  return { ...rule, cases };
}

export function removeSwitchCase(rule: JsonFieldRule, key: string): JsonFieldRule {
  const cases = { ...(rule.cases ?? {}) };
  delete cases[key];
  return { ...rule, cases: Object.keys(cases).length ? cases : { '0': [emptyField()] } };
}

export function documentToJson(doc: JsonRuleDocument): string {
  return JSON.stringify(doc, null, 2);
}

export function moveRule(rules: JsonFieldRule[], index: number, dir: -1 | 1): JsonFieldRule[] {
  const next = cloneRules(rules);
  const target = index + dir;
  if (target < 0 || target >= next.length) return rules;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function duplicateRule(rules: JsonFieldRule[], index: number): JsonFieldRule[] {
  const copy = structuredClone(rules[index]);
  if (copy.name) copy.name = `${copy.name}_copy`;
  const next = cloneRules(rules);
  next.splice(index + 1, 0, copy);
  return next;
}
