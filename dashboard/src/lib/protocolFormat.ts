import type { JsonFieldRule, JsonRuleDocument } from '../types/ruleparser';
import lcpRules from '../lib/ruleparser/lcpOspRules.json';

/** Canonical LCP/OSP rules — same file as backend/internal/protocol/lcp_osp_rules.json */
export const DEFAULT_LCP_PARSE_RULES = lcpRules as JsonRuleDocument;

const SKIP_NAMES = new Set(['stx', 'etx', 'crc16', 'length', 'attr', 'attribute']);

function walkRules(rules: JsonFieldRule[], prefix: string, out: Set<string>) {
  for (const r of rules) {
    const path = prefix ? `${prefix}.${r.name}` : r.name;
    if (r.name && !SKIP_NAMES.has(r.name) && !['Switch', 'RepeatCount', 'Optional', 'Validate', 'Bits'].includes(r.type)) {
      out.add(path);
    }
    if (r.item_rules?.length) walkRules(r.item_rules, path, out);
    if (r.rules?.length) walkRules(r.rules, path, out);
    if (r.fields?.length) walkRules(r.fields, path, out);
    if (r.cases) {
      for (const caseRules of Object.values(r.cases)) {
        walkRules(caseRules, prefix ? `${prefix}.${r.name}` : r.name, out);
      }
    }
  }
}

/** Suggested viz field paths from parse_rules tree */
export function collectParseRuleFieldPaths(doc?: JsonRuleDocument): string[] {
  if (!doc?.fields?.length) return [];
  const out = new Set<string>();
  walkRules(doc.fields, '', out);
  return [...out];
}

export function protocolFormatLabel(p: { parse_rules?: JsonRuleDocument }): string {
  const meta = p.parse_rules?._meta;
  if (meta && typeof meta.name === 'string') return `Rules · ${meta.name}`;
  const n = p.parse_rules?.fields?.length ?? 0;
  return `Serial Parser · ${n} fields`;
}

export function protocolFieldCount(p: { parse_rules?: JsonRuleDocument }): number {
  return p.parse_rules?.fields?.length ?? 0;
}
