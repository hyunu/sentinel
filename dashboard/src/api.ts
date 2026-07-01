const BASE = '/api/v1';

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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
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
  last_heartbeat: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProtocolSpec {
  id: string;
  name: string;
  version: string;
  description?: string;
  parse_rules: JsonRuleDocument;
  created_at: string;
  updated_at: string;
}

export interface SchemaPreset {
  id: string;
  name: string;
  description?: string;
  protocol_version?: string;
  parse_rules: JsonRuleDocument;
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
  chart_type: 'line' | 'bar' | 'scatter' | 'area';
  y_axis: YAxisConfig;
  offset: number;
  weight: number;
}

export interface VizProfile {
  id: string;
  name: string;
  description?: string;
  board_id: string;
  session_ids?: string[];
  time_range?: { start: string; end: string };
  items: VizItem[];
  created_at: string;
  updated_at: string;
}

export interface Temperature {
  id: string;
  board_id: string;
  timestamp: string;
  value_celsius: number;
}

export const api = {
  boards: {
    list: () => request<Board[]>('/boards'),
    get: (id: string) => request<Board>(`/boards/${id}`),
    register: (data: { name?: string; mac_address: string; wifi_mac?: string; location?: string; uid?: string; protocol_id?: string }) =>
      request<{ uid: string; board: Board }>('/boards/register', { method: 'POST', body: JSON.stringify(data) })
        .then(r => r.board),
    update: (id: string, data: { name?: string; firmware_version?: string; location?: string; protocol_id?: string | null }) =>
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
    create: (data: { board_id: string; name: string; description?: string }) =>
      request<Session>('/sessions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Session>) =>
      request<void>(`/sessions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
    autoSplit: (board_id: string, type: string = 'timegap', gapSeconds: number = 60) =>
      request<{ sessions_created: number }>('/sessions/auto-split', {
        method: 'POST',
        body: JSON.stringify({ board_id, type, params: { gap_seconds: gapSeconds } }),
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
    }) =>
      request<{
        data: Array<{ timestamp: string; values: Record<string, number> }>;
        meta?: { total_matched: number; returned: number; downsampled: boolean };
      }>(
        '/viz/query-items', { method: 'POST', body: JSON.stringify(data) }
      ),
  },

  ai: {
    query: (board_id: string, query: string) =>
      request<{ query: string; answer: string; context: unknown }>('/ai/query', {
        method: 'POST',
        body: JSON.stringify({ board_id, query }),
      }),
  },
};
