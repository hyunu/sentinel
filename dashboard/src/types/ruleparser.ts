/**
 * Serial Parser JSON types — mirrors backend/internal/ruleparser (json_rule_engine.go).
 * Keep in sync with Go struct json tags.
 */

export interface ExprDef {
  expr: string;
}

export interface BitDef {
  name: string;
  bits: number;
}

export interface JsonFieldRule {
  name: string;
  type: string;
  endian?: string;
  size?: number;
  encoding?: string;
  length_from?: string | ExprDef;
  count_from?: string | ExprDef;
  delimiter?: number[];
  len_type?: JsonFieldRule;
  item_type?: JsonFieldRule;
  item_rules?: JsonFieldRule[];
  key_from?: string;
  cases?: Record<string, JsonFieldRule[]>;
  default?: JsonFieldRule[];
  predicate?: ExprDef;
  then?: JsonFieldRule[];
  else?: JsonFieldRule[];
  rules?: JsonFieldRule[];
  fields?: JsonFieldRule[];
  bits?: BitDef[];
  expr?: string;
  transform_expr?: string;
  validate_expr?: string;
  inner?: JsonFieldRule;
}

export interface JsonRuleSet {
  fields: JsonFieldRule[];
}

export interface JsonRuleDocument {
  _meta?: Record<string, unknown>;
  fields: JsonFieldRule[];
}

export interface ParseResult {
  fields: Record<string, unknown>;
  tree: Record<string, unknown>;
  fid: string;
  seq_no: number;
  length: number;
  crc16: number;
  valid: boolean;
  error?: string;
}

export function hasParseRules(doc?: JsonRuleDocument | null): boolean {
  return Boolean(doc?.fields?.length);
}
