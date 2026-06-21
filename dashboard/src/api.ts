const BASE = '/api/v1';

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
  name: string;
  mac_address: string;
  firmware_version?: string;
  last_heartbeat: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FieldSpec {
  name: string;
  offset: number;
  length: number;
  type: string;
  unit?: string;
  enum_mapping?: Record<string, number>;
  endian?: string;
}

export interface ProtocolSpec {
  id: string;
  name: string;
  version: string;
  description?: string;
  fields: FieldSpec[];
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
  color: string;
  visible: boolean;
  field_ref: { protocol_id: string; field_name: string };
  chart_type: 'line' | 'bar' | 'scatter';
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
    register: (data: { name: string; mac_address: string }) =>
      request<Board>('/boards/register', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Board>) =>
      request<void>(`/boards/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  heartbeat: (board_id: string) =>
    request<{ message: string }>('/heartbeat', { method: 'POST', body: JSON.stringify({ board_id }) }),

  uart: {
    list: (params?: { board_id?: string; session_id?: string; direction?: string; since?: string }) => {
      const qs = new URLSearchParams();
      if (params?.board_id) qs.set('board_id', params.board_id);
      if (params?.session_id) qs.set('session_id', params.session_id);
      if (params?.direction) qs.set('direction', params.direction);
      if (params?.since) qs.set('since', params.since);
      return request<UartData[]>(`/data/uart?${qs}`);
    },
    ingest: (board_id: string, raw_hex: string, direction: string) =>
      request<UartData>('/data/uart', { method: 'POST', body: JSON.stringify({ board_id, raw_hex, direction }) }),
  },

  temperature: {
    list: (board_id?: string) => {
      const qs = board_id ? `?board_id=${board_id}` : '';
      return request<Temperature[]>(`/data/temperature${qs}`);
    },
  },

  protocols: {
    list: () => request<ProtocolSpec[]>('/protocols'),
    get: (id: string) => request<ProtocolSpec>(`/protocols/${id}`),
    create: (data: Omit<ProtocolSpec, 'id' | 'created_at' | 'updated_at'>) =>
      request<ProtocolSpec>('/protocols', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<ProtocolSpec>) =>
      request<void>(`/protocols/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/protocols/${id}`, { method: 'DELETE' }),
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
    queryItems: (data: { board_id: string; items: VizItem[]; time_range?: { start: string; end: string }; since?: string }) =>
      request<{ data: Array<{ timestamp: string; values: Record<string, number> }> }>(
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
