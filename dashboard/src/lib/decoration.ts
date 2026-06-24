/** Evaluate decoration template like "{v/10}.{v%10}" with integer v. */
export function applyDecoration(template: string, v: number): string {
  if (!template) return '';
  let out = '';
  let i = 0;
  while (i < template.length) {
    if (template[i] === '{') {
      const end = template.indexOf('}', i);
      if (end < 0) throw new Error('unclosed expression in decoration');
      const expr = template.slice(i + 1, end).trim();
      out += String(evalDecorationExpr(expr, v));
      i = end + 1;
    } else {
      out += template[i];
      i++;
    }
  }
  return out;
}

export function fieldValueToInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'bigint') return Number(v);
  return null;
}

export function applyFieldDecoration(_name: string, decoration: string | undefined, val: unknown): string | null {
  if (!decoration) return null;
  const iv = fieldValueToInt(val);
  if (iv === null) return null;
  try {
    return applyDecoration(decoration, iv);
  } catch {
    return null;
  }
}

function evalDecorationExpr(expr: string, v: number): number {
  const tokens = tokenize(expr.replace(/\bv\b/g, ` ${v} `));
  let pos = 0;

  const parseExpr = (): number => {
    let left = parseTerm();
    while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
      const op = tokens[pos++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number => {
    let left = parseFactor();
    while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/' || tokens[pos] === '%')) {
      const op = tokens[pos++];
      const right = parseFactor();
      if (op === '*') left *= right;
      else if (op === '/') left = Math.trunc(left / right);
      else left %= right;
    }
    return left;
  };

  const parseFactor = (): number => {
    const t = tokens[pos];
    if (t === '(') {
      pos++;
      const n = parseExpr();
      if (tokens[pos] !== ')') throw new Error('missing closing parenthesis');
      pos++;
      return n;
    }
    if (t === '-' && tokens[pos + 1] !== undefined) {
      pos++;
      return -parseFactor();
    }
    if (t === undefined || t === ')' || t === '+' || t === '*' || t === '/' || t === '%') {
      throw new Error('unexpected end of expression');
    }
    pos++;
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error(`invalid number ${t}`);
    return Math.trunc(n);
  };

  const result = parseExpr();
  if (pos < tokens.length) throw new Error('unexpected trailing input');
  return result;
}

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ('()+-*/%'.includes(c)) {
      tokens.push(c);
      i++;
      continue;
    }
    if (/[\d-]/.test(c)) {
      let j = i;
      if (c === '-') j++;
      while (j < expr.length && /\d/.test(expr[j])) j++;
      if (j > i + (c === '-' ? 1 : 0)) {
        tokens.push(expr.slice(i, j));
        i = j;
        continue;
      }
    }
    throw new Error(`invalid token at ${expr.slice(i)}`);
  }
  return tokens;
}
