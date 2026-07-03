export type TranslationParams = Record<string, string | number>;
export type Messages = Record<string, unknown>;

export function translate(messages: Messages, key: string, params?: TranslationParams): string {
  const parts = key.split('.');
  let val: unknown = messages;
  for (const part of parts) {
    if (val !== null && typeof val === 'object' && part in val) {
      val = (val as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  if (typeof val !== 'string') return key;
  if (!params) return val;
  return val.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = params[name];
    return v !== undefined ? String(v) : '';
  });
}
