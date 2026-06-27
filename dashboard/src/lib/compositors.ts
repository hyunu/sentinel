import type { FieldSpec } from '../api';
import { applyFieldDecoration } from './decoration';
import {
  alignByte,
  boundEnd,
  isBitField,
  newParseCursor,
  readBitField,
  type ParseCursor,
} from './bits';
import { fieldUsesRemaining, readRemainingField } from './bounds';
import { bytesToHex, readField } from './fieldRead';

export function normalizeVariantKey(val: unknown): string {
  if (typeof val === 'number') {
    return val.toString(16).padStart(2, '0').toUpperCase();
  }
  if (typeof val === 'string') {
    const s = val.replace(/^0x/i, '').toUpperCase();
    return s.length === 1 ? `0${s}` : s;
  }
  return String(val ?? '');
}

export function lookupDispatchVariants(
  variants: Record<string, FieldSpec[]> | undefined,
  key: string,
): FieldSpec[] | undefined {
  if (!variants) return undefined;
  const candidates = [key, key.toUpperCase(), key.length === 1 ? `0${key.toUpperCase()}` : key];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    if (variants[c]) return variants[c];
  }
  return undefined;
}

function findTaggedVariant(flagStr: string, variants: FieldSpec[]): FieldSpec | undefined {
  return variants.find(v => v.flag && v.flag.toUpperCase() === flagStr.toUpperCase());
}

function parseTaggedBlock(data: number[], offset: number, field: FieldSpec): { item: Record<string, unknown>; offset: number } {
  if (offset >= data.length) return { item: {}, offset };

  const flagStr = data[offset].toString(16).padStart(2, '0').toUpperCase();
  offset++;
  if (offset >= data.length) return { item: { flag: flagStr }, offset };

  const blockLen = data[offset];
  offset++;
  const blockData = data.slice(offset, offset + blockLen);
  offset += blockLen;

  const item: Record<string, unknown> = { flag: flagStr, length: blockLen };
  const variant = findTaggedVariant(flagStr, field.fields || []);
  if (variant) {
    if (variant.name) item._name = variant.name;
    const { fields: sub } = parseFieldsWithScope(blockData, variant.fields || [], { _block_length: blockLen });
    Object.assign(item, sub);
  } else if (blockData.length > 0) {
    item.raw = bytesToHex(blockData);
  }
  return { item, offset };
}

function parseTaggedRepeat(data: number[], offset: number, field: FieldSpec): { items: Record<string, unknown>[]; offset: number } {
  const items: Record<string, unknown>[] = [];
  const until = field.tagged_until || 'no_matching_flag';

  while (offset < data.length) {
    const flagStr = data[offset].toString(16).padStart(2, '0').toUpperCase();
    const variant = findTaggedVariant(flagStr, field.fields || []);
    if (!variant) {
      if (until === 'no_matching_flag') break;
      break;
    }

    offset++;
    if (offset >= data.length) break;
    const blockLen = data[offset];
    offset++;
    if (offset + blockLen > data.length) break;

    const blockData = data.slice(offset, offset + blockLen);
    offset += blockLen;

    const item: Record<string, unknown> = { flag: flagStr, length: blockLen };
    if (variant.name) item._name = variant.name;
    const { fields: sub } = parseFieldsWithScope(blockData, variant.fields || [], { _block_length: blockLen });
    Object.assign(item, sub);
    items.push(item);
  }

  return { items, offset };
}

function parseDispatchField(
  data: number[],
  cur: ParseCursor,
  field: FieldSpec,
  scope: Record<string, unknown>,
): unknown {
  const on = field.dispatch_on;
  if (!on) return null;

  const keyVal = scope[on];
  let variantFields: FieldSpec[] | undefined;
  if (keyVal !== undefined && keyVal !== null) {
    variantFields = lookupDispatchVariants(field.dispatch_variants, normalizeVariantKey(keyVal));
  }
  if (!variantFields?.length) variantFields = field.default_fields;

  const end = boundEnd(cur, data.length);

  if (!variantFields?.length) {
    const remaining = bytesToHex(data.slice(cur.byteOff, end));
    cur.byteOff = end;
    cur.bitOff = 0;
    return remaining;
  }

  const start = cur.byteOff;
  const { fields: sub, offset: n } = parseFieldsWithScope(data.slice(start, end), variantFields, scope);
  cur.byteOff = start + n;
  cur.bitOff = 0;

  if (variantFields.length === 1 && variantFields[0].name && sub[variantFields[0].name] !== undefined) {
    return sub[variantFields[0].name];
  }
  const keys = Object.keys(sub);
  if (keys.length === 1) return sub[keys[0]];
  return sub;
}

function parseOneField(
  data: number[],
  cur: ParseCursor,
  field: FieldSpec,
  scope: Record<string, unknown>,
): unknown {
  if (field.condition) {
    const condVal = scope[field.condition];
    if (condVal === 0 || condVal === undefined || condVal === null) return null;
  }

  if (fieldUsesRemaining(field)) {
    return readRemainingField(data, cur, field);
  }

  switch (field.type) {
    case 'struct': {
      alignByte(cur);
      const { fields: sub, offset: n } = parseFieldsWithScope(data.slice(cur.byteOff), field.fields || [], {});
      cur.byteOff += n;
      cur.bitOff = 0;
      return sub;
    }
    case 'dispatch': {
      alignByte(cur);
      return parseDispatchField(data, cur, field, scope);
    }
    case 'tagged_repeat': {
      alignByte(cur);
      const { items, offset: n } = parseTaggedRepeat(data, cur.byteOff, field);
      cur.byteOff += n;
      cur.bitOff = 0;
      return items;
    }
    case 'tagged_block': {
      alignByte(cur);
      const { item, offset: n } = parseTaggedBlock(data, cur.byteOff, field);
      cur.byteOff += n;
      cur.bitOff = 0;
      return item;
    }
    case 'function_args': {
      alignByte(cur);
      const wrapped = { ...field, type: 'tagged_repeat', tagged_until: field.tagged_until || 'no_matching_flag' };
      const { items, offset: n } = parseTaggedRepeat(data, cur.byteOff, wrapped);
      cur.byteOff += n;
      cur.bitOff = 0;
      return items;
    }
    case 'func_result': {
      alignByte(cur);
      const wrapped = { ...field, type: 'tagged_block' };
      const { item, offset: n } = parseTaggedBlock(data, cur.byteOff, wrapped);
      cur.byteOff += n;
      cur.bitOff = 0;
      return item;
    }
    default:
      break;
  }

  if (field.fields?.length && field.type !== 'raw' && field.type !== 'dynamic') {
    alignByte(cur);
    const { fields: sub, offset: n } = parseFieldsWithScope(data.slice(cur.byteOff), field.fields, {});
    cur.byteOff += n;
    cur.bitOff = 0;
    return sub;
  }

  if (isBitField(field)) {
    const value = readBitField(data, cur, field);
    return value;
  }

  alignByte(cur);

  if (field.type === 'dynamic') {
    if (field.dispatch_on && field.dispatch_variants) {
      return parseDispatchField(data, cur, field, scope);
    }
    return readRemainingField(data, cur, field);
  }

  if (!field.length && field.type !== 'dynamic') return null;

  const end = boundEnd(cur, data.length);
  const { value, nextOffset } = readField(data, cur.byteOff, field);
  if (nextOffset > end) {
    throw new Error(`field ${field.name}: read past container (${nextOffset} > ${end})`);
  }
  cur.byteOff = nextOffset;
  cur.bitOff = 0;
  return value;
}

export function parseFieldsWithScope(
  data: number[],
  fields: FieldSpec[],
  outerScope: Record<string, unknown>,
): { fields: Record<string, unknown>; offset: number } {
  const result: Record<string, unknown> = {};
  const cur = newParseCursor(data.length);
  const scope: Record<string, unknown> = { ...outerScope };

  for (const field of fields) {
    const val = parseOneField(data, cur, field, scope);
    if (val === null && field.condition) continue;

    if (field.name) {
      result[field.name] = val;
      scope[field.name] = val;
      const decorated = applyFieldDecoration(field.name, field.decoration, val);
      if (decorated !== null) result[`${field.name}_display`] = decorated;
    } else if (!field.type && field.fields?.length && typeof val === 'object' && val !== null) {
      Object.assign(result, val as Record<string, unknown>);
      Object.assign(scope, val as Record<string, unknown>);
    }
  }

  return { fields: result, offset: cur.byteOff };
}

export function parseFieldsSequential(data: number[], fields: FieldSpec[]): { fields: Record<string, unknown>; offset: number } {
  return parseFieldsWithScope(data, fields, {});
}
