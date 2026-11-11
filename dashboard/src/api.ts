const BASE = '/api/v1';
const AI_TOKEN_STORAGE_KEY = 'sentinel-ai-token';

function aiAuthHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(AI_TOKEN_STORAGE_KEY)?.trim();
    return token ? { 'X-AI-Token': token } : {};
  } catch {
    return {};
  }
}

import { extractSSEEvents } from './lib/aiSse';
import type { JsonRuleDocument, ParseResult } from './types/ruleparser';

export type {
  BitDef,
  ExprDef,
  JsonFieldRule,
  JsonRuleDocument,
  JsonRuleSet,
  ParseResult,
} from './types/ruleparser';
export { hasParseRules } from './types/ruleparser';

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  /** Called while the response body is downloading. total is null for chunked responses. */
  onProgress?: (loaded: number, total: number | null) => void;
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const { timeoutMs, onProgress, ...fetchOptions } = options ?? {};
  const controller = new AbortController();
  const externalSignal = fetchOptions.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 30000);

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...fetchOptions.headers },
      ...fetchOptions,
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }

    if (onProgress && res.body) {
      const contentLength = Number(res.headers.get('Content-Length'));
      const total = Number.isFinite(contentLength) && contentLength > 0
        ? contentLength
        : null;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      let lastReport = 0;
      const report = (force = false) => {
        const now = Date.now();
        if (force || now - lastReport >= 100) {
          lastReport = now;
          onProgress(loaded, total);
        }
      };

      report(true);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        loaded += value.byteLength;
        report();
      }
      report(true);

      const buffer = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(buffer)) as T;
    }

    return await res.json() as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timeout or cancelled', { cause: error });
    }
    throw new Error(error instanceof Error ? error.message : 'Request failed', { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

export interface Board {
  id: string;
  uid?: string;
  name: string;
  mac_address: string;
  wifi_mac?: string;
  firmware_version?: string;
  wifi_rssi?: number;
  location?: string;
  protocol_id?: string;
  session_split_rules?: SessionSplitRule[];
  session_rule_mode?: 'cut' | 'range';
  last_heartbeat: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SessionSplitRule {
  id: string;
  name: string;
  enabled: boolean;
  fid?: string;
  direction?: '' | 'TX' | 'RX';
  field?: string;
  operator?: 'eq' | 'neq' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
  role?: '' | 'start' | 'end';
  value?: string;
}

export interface ProtocolSpec {
  id: string;
  name: string;
  version: string;
  description?: string;
  parse_rules: JsonRuleDocument;
  /** Protocol-level value→label maps, separate from parse_rules. */
  enums?: Record<string, Record<string, string>>;
  created_at: string;
  updated_at: string;
}

export interface SchemaPreset {
  id: string;
  name: string;
  description?: string;
  protocol_version?: string;
  parse_rules: JsonRuleDocument;
  enums?: Record<string, Record<string, string>>;
  created_at: string;
  updated_at: string;
}

export interface UartData {
  id: string;
  board_id: string;
  session_id?: string;
  timestamp: string;
  raw_hex: string;
  parsed_fields?: Record<string, unknown>;
  direction: 'TX' | 'RX';
}

export interface UartCursor {
  timestamp: string;
  id: string;
}

export interface UartQueryResult {
  items: UartData[];
  total?: number;
  has_more: boolean;
  next_before?: UartCursor;
}

export interface DataDeleteResult {
  board_id: string;
  since?: string | null;
  until?: string | null;
  deleted: {
    uart_data: number;
    viz_rollups: number;
    sessions: number;
    temperatures: number;
    heartbeats: number;
  };
}

export interface DataReparseJob {
  id: string;
  board_id: string;
  protocol_id: string;
  protocol_version: string;
  mode: 'missing' | 'all';
  since?: string | null;
  until?: string | null;
  session_id?: string;
  direction?: string;
  backup_parsed: boolean;
  clear_rollups: boolean;
  state: 'running' | 'canceling' | 'canceled' | 'done' | 'failed';
  phase: 'parse' | 'rollups' | 'done';
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  rollups_cleared: number;
  cancel_requested: boolean;
  error?: string;
  created_at: string;
  started_at: string;
  updated_at: string;
  finished_at?: string | null;
}

export interface Session {
  id: string;
  board_id: string;
  name: string;
  description?: string;
  start_time: string;
  end_time?: string;
  tags?: string[];
  created_at: string;
}

export interface YAxisConfig {
  id: string;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
}

export interface VizItem {
  id: string;
  label: string;
  short_label?: string;
  color: string;
  visible: boolean;
  field_ref: { protocol_id: string; field_name: string };
  chart_type: 'line' | 'bar' | 'area';
  y_axis: YAxisConfig;
  offset: number;
  weight: number;
  favorite?: boolean;
}

export interface VizProfile {
  id: string;
  name: string;
  description?: string;
  board_id: string;
  session_ids?: string[];
  time_range?: { start: string; end: string };
  /** Server-persisted fixed analog Y ranges. Missing side means Auto. */
  y_axis_range?: {
    left?: { min: number; max: number };
    right?: { min: number; max: number };
  };
  /** Per-profile overrides for protocol-declared event overlays. */
  event_overlays?: Record<string, { type?: string; visible?: boolean }>;
  items: VizItem[];
  created_at: string;
  updated_at: string;
}

export interface VizCommandFunction {
  function_id: number;
  arg_count?: number;
  args?: string[];
}

export interface VizCommandResult {
  function_id?: number;
  flag?: number;
  error_code?: number;
  is_error?: boolean;
  is_monitor?: boolean;
}

export interface VizCommandConfig {
  fid: string;
  kind: string;
  type: string;
  visible: boolean;
  color?: string;
  label?: string;
}

export interface VizCommandEvent {
  timestamp: string;
  direction: 'TX' | 'RX';
  fid: number;
  kind: string;
  summary: string;
  color?: string;
  style?: string;
  functions?: VizCommandFunction[];
  results?: VizCommandResult[];
  recv_fid?: number;
  error_code?: number;
}

export interface Temperature {
  id: string;
  board_id: string;
  timestamp: string;
  value_celsius: number;
}

export interface AIToolCall {
  name: string;
  arguments: unknown;
  duration_ms: number;
  error?: string;
}

export interface AIChartSpec {
  board_id: string;
  protocol_id?: string;
  fields: string[];
  start: string;
  end: string;
  aggregation?: string;
  bucket_seconds?: number;
  title?: string;
}

export interface AISettings {
  provider: string;
  base_url: string;
  model: string;
  has_api_key: boolean;
  max_tokens: number;
  temperature: number;
  timeout_seconds: number;
  max_tool_rounds: number;
  updated_at?: string;
}

export interface AISettingsInput {
  provider: string;
  base_url: string;
  model: string;
  api_key: string;
  max_tokens: number;
  temperature: number;
  timeout_seconds: number;
  max_tool_rounds: number;
}

export interface AIStatus {
  configured: boolean;
  provider?: string;
  model?: string;
  max_rounds?: number;
  tools?: number;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIQueryRequest {
  board_id: string;
  query: string;
  protocol_id?: string;
  history?: AIMessage[];
}

export interface AIStreamEvent {
  type: 'round' | 'token' | 'tool_call' | 'done' | 'error';
  content?: string;
  code?: string;
  round?: number;
  tool_call?: AIToolCall;
  result?: AIQueryResult;
}

export interface AIQueryResult {
  answer: string;
  provider: string;
  model: string;
  board_id: string;
  protocol_id?: string;
  tool_calls?: AIToolCall[];
  chart?: AIChartSpec | null;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
  rounds: number;
}

export const api = {
  boards: {
    list: () => request<Board[]>('/boards'),
    get: (id: string) => request<Board>(`/boards/${id}`),
    register: (data: { name?: string; mac_address: string; wifi_mac?: string; location?: string; uid?: string; protocol_id?: string }) =>
      request<{ uid: string; board: Board }>('/boards/register', { method: 'POST', body: JSON.stringify(data) })
        .then(r => r.board),
    update: (id: string, data: { name?: string; firmware_version?: string; location?: string; protocol_id?: string | null; session_split_rules?: SessionSplitRule[]; session_rule_mode?: 'cut' | 'range' }) =>
      request<Board>(`/boards/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ message: string; pending?: boolean; deleted?: Record<string, number> }>(`/boards/${id}`, { method: 'DELETE' }),
  },

  heartbeat: (board_id: string) =>
    request<{ message: string }>('/heartbeat', { method: 'POST', body: JSON.stringify({ board_id }) }),

  uart: {
    list: (params?: {
      board_id?: string;
      session_id?: string;
      direction?: string;
      since?: string;
      until?: string;
      before_ts?: string;
      before_id?: string;
      limit?: string | number;
      include_total?: boolean;
    }) => {
      const qs = new URLSearchParams();
      if (params?.board_id) qs.set('board_id', params.board_id);
      if (params?.session_id) qs.set('session_id', params.session_id);
      if (params?.direction) qs.set('direction', params.direction);
      if (params?.since) qs.set('since', params.since);
      if (params?.until) qs.set('until', params.until);
      if (params?.before_ts) qs.set('before_ts', params.before_ts);
      if (params?.before_id) qs.set('before_id', params.before_id);
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.include_total) qs.set('include_total', 'true');
      return request<UartQueryResult>(`/data/uart?${qs}`);
    },
    ingest: (board_id: string, raw_hex: string, direction: string) =>
      request<UartData>('/data/uart', { method: 'POST', body: JSON.stringify({ board_id, raw_hex, direction }) }),
  },

  data: {
    /** Same-origin URL for the streaming dump endpoint (used by <a download>). */
    dumpUrl: (params: {
      board_id: string;
      since?: string;
      until?: string;
      session_id?: string;
      direction?: string;
      include?: string;
      limit?: number;
      format?: 'ndjson' | 'json';
      gzip?: boolean;
    }) => {
      const qs = new URLSearchParams();
      qs.set('board_id', params.board_id);
      if (params.since) qs.set('since', params.since);
      if (params.until) qs.set('until', params.until);
      if (params.session_id) qs.set('session_id', params.session_id);
      if (params.direction) qs.set('direction', params.direction);
      if (params.include) qs.set('include', params.include);
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.format) qs.set('format', params.format);
      if (params.gzip) qs.set('gzip', 'true');
      return `${BASE}/data/dump?${qs}`;
    },
    delete: (params: {
      board_id: string;
      confirm: boolean;
      since?: string;
      until?: string;
      include?: string;
    }) => {
      const qs = new URLSearchParams();
      qs.set('board_id', params.board_id);
      qs.set('confirm', params.confirm ? 'true' : 'false');
      if (params.since) qs.set('since', params.since);
      if (params.until) qs.set('until', params.until);
      if (params.include) qs.set('include', params.include);
      return request<DataDeleteResult>(`/data?${qs}`, {
        method: 'DELETE',
        timeoutMs: 120000,
      });
    },
    reparseStart: (params: {
      board_id: string;
      protocol_id: string;
      mode: 'missing' | 'all';
      since?: string;
      until?: string;
      session_id?: string;
      direction?: string;
      backup_parsed?: boolean;
      clear_rollups?: boolean;
    }) => request<{ job_id: string; total: number }>('/data/reparse', {
      method: 'POST',
      body: JSON.stringify(params),
      timeoutMs: 30000,
    }),
    reparseStatus: (jobId: string) =>
      request<DataReparseJob>(`/data/reparse/${jobId}`),
    reparseCancel: (jobId: string) =>
      request<{ message: string }>(`/data/reparse/${jobId}/cancel`, { method: 'POST' }),
  },

  temperature: {
    list: (params?: { board_id?: string; uid?: string; since?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.board_id) qs.set('board_id', params.board_id);
      if (params?.uid) qs.set('uid', params.uid);
      if (params?.since) qs.set('since', params.since);
      if (params?.limit) qs.set('limit', String(params.limit));
      const q = qs.toString();
      return request<Temperature[]>(`/data/temperature${q ? `?${q}` : ''}`);
    },
  },

  protocols: {
    list: () => request<ProtocolSpec[]>('/protocols'),
    get: (id: string) => request<ProtocolSpec>(`/protocols/${id}`),
    create: (data: Omit<ProtocolSpec, 'id' | 'created_at' | 'updated_at'>) =>
      request<ProtocolSpec>('/protocols', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Omit<ProtocolSpec, 'id' | 'created_at' | 'updated_at'>>) =>
      request<void>(`/protocols/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/protocols/${id}`, { method: 'DELETE' }),
    seedDefault: () => request<{ message: string; id?: string }>('/protocols/seed-default', { method: 'POST' }),
    parse: (data: { raw_hex: string; protocol_id?: string; parse_rules?: JsonRuleDocument }) =>
      request<ParseResult>('/protocols/parse', { method: 'POST', body: JSON.stringify(data) }),
  },

  schemaPresets: {
    list: () => request<SchemaPreset[]>('/schema-presets'),
    get: (id: string) => request<SchemaPreset>(`/schema-presets/${id}`),
    create: (data: Omit<SchemaPreset, 'id' | 'created_at' | 'updated_at'>) =>
      request<SchemaPreset>('/schema-presets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Omit<SchemaPreset, 'id' | 'created_at' | 'updated_at'>>) =>
      request<void>(`/schema-presets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/schema-presets/${id}`, { method: 'DELETE' }),
    seedDefault: () => request<{ message: string }>('/schema-presets/seed-default', { method: 'POST' }),
  },

  sessions: {
    list: (board_id?: string) => {
      const qs = board_id ? `?board_id=${board_id}` : '';
      return request<Session[]>(`/sessions${qs}`);
    },
    create: (data: { board_id: string; name: string; description?: string; start_time?: string; end_time?: string; tags?: string[] }) =>
      request<Session>('/sessions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Session>) =>
      request<void>(`/sessions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
    autoSplit: (board_id: string, type: string = 'timegap', gapSeconds: number = 60) =>
      request<{ sessions_created: number }>('/sessions/auto-split', {
        method: 'POST',
        body: JSON.stringify({ board_id, type, params: { gap_seconds: gapSeconds } }),
      }),
    splitByRules: (board_id: string, replace = true, minGapSeconds = 1) =>
      request<{
        sessions_created: number;
        cuts: number;
        ranges: number;
        rows_assigned: number;
        unclosed_starts: number;
        mode: 'cut' | 'range';
      }>('/sessions/split-by-rules', {
        method: 'POST',
        body: JSON.stringify({ board_id, replace, min_gap_seconds: minGapSeconds }),
        timeoutMs: 180000,
      }),
  },

  viz: {
    listProfiles: (board_id?: string) => {
      const qs = board_id ? `?board_id=${board_id}` : '';
      return request<VizProfile[]>(`/viz/profiles${qs}`);
    },
    getProfile: (id: string) => request<VizProfile>(`/viz/profiles/${id}`),
    createProfile: (data: Omit<VizProfile, 'id' | 'created_at' | 'updated_at'>) =>
      request<VizProfile>('/viz/profiles', { method: 'POST', body: JSON.stringify(data) }),
    updateProfile: (id: string, data: VizProfile) =>
      request<void>(`/viz/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteProfile: (id: string) => request<void>(`/viz/profiles/${id}`, { method: 'DELETE' }),
    commands: (params: {
      board_id: string;
      since?: string;
      until?: string;
      direction?: 'TX' | 'RX';
    }, options?: { signal?: AbortSignal }) => {
      const qs = new URLSearchParams({ board_id: params.board_id });
      if (params.since) qs.set('since', params.since);
      if (params.until) qs.set('until', params.until);
      if (params.direction) qs.set('direction', params.direction);
      return request<{ items: VizCommandEvent[]; total: number; config?: VizCommandConfig[] }>(
        `/viz/commands?${qs.toString()}`,
        { signal: options?.signal },
      );
    },
    apply: (id: string) =>
      request<{ profile: VizProfile; data: Array<{ timestamp: string; values: Record<string, number> }> }>(
        `/viz/profiles/${id}/apply`, { method: 'POST' }
      ),
    queryItems: (data: {
      board_id: string;
      items: VizItem[];
      time_range?: { start: string; end: string };
      since?: string;
      limit?: number;
      aggregation?: 'avg' | 'min' | 'max';
      bucket_seconds?: number;
      mode?: 'live';
      sampling?: 'raw-sample' | 'envelope' | 'raw-page';
      buckets?: number;
      skip?: number;
    }, options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onProgress?: (loaded: number, total: number | null) => void;
    }) =>
      request<{
        data: Array<{ timestamp: string; values: Record<string, number> }>;
        meta?: {
          total_matched: number;
          returned: number;
          downsampled: boolean;
          domain?: Record<string, { min: number; max: number }>;
        };
      }>(
        '/viz/query-items', {
          method: 'POST',
          body: JSON.stringify(data),
          signal: options?.signal,
          timeoutMs: options?.timeoutMs,
          onProgress: options?.onProgress,
        }
      ),
    spectrum: (data: {
      board_id: string;
      start?: string;
      end?: string;
      bins?: number;
    }, options?: { signal?: AbortSignal; timeoutMs?: number }) =>
      request<{
        start: string;
        end: string;
        bins: number;
        present: boolean[];
        /** Raw frame count per presence bin (newer servers). */
        counts?: number[];
      }>(
        '/viz/spectrum', {
          method: 'POST',
          body: JSON.stringify(data),
          signal: options?.signal,
          timeoutMs: options?.timeoutMs,
        }
      ),
  },

  ai: {
    status: () => request<AIStatus>('/ai/status', { headers: aiAuthHeaders() }),
    getSettings: () => request<AISettings>('/ai/settings', { headers: aiAuthHeaders() }),
    saveSettings: (data: AISettingsInput) =>
      request<AISettings>('/ai/settings', {
        method: 'PUT',
        headers: aiAuthHeaders(),
        body: JSON.stringify(data),
        timeoutMs: 20000,
      }),
    query: (data: AIQueryRequest) =>
      request<AIQueryResult>('/ai/query', {
        method: 'POST',
        headers: aiAuthHeaders(),
        body: JSON.stringify(data),
        timeoutMs: 120000,
      }),
    stream: async (
      data: AIQueryRequest,
      handlers: {
        onEvent: (event: AIStreamEvent) => void;
        signal?: AbortSignal;
      },
    ) => {
      const res = await fetch(`${BASE}/ai/query/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiAuthHeaders() },
        body: JSON.stringify(data),
        signal: handlers.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Request failed');
      }
      if (!res.body) {
        throw new Error('Streaming is not supported by this browser');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const extracted = extractSSEEvents(buffer);
        buffer = extracted.rest;
        for (const payload of extracted.events) {
          try {
            handlers.onEvent(JSON.parse(payload) as AIStreamEvent);
          } catch {
            /* ignore malformed event */
          }
        }
      }
    },
  },
};
