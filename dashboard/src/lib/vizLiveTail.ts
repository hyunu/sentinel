export type LiveVizRow = { timestamp: string; values: Record<string, number> };

export const LIVE_FOLLOW_EDGE_MS = 250;

export function parseLiveTimestampMs(timestamp: string): number | null {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

export function mergeLiveRows(existing: LiveVizRow[], incoming: LiveVizRow[]): LiveVizRow[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;
  const lastMs = parseLiveTimestampMs(existing[existing.length - 1].timestamp);
  if (lastMs == null) return [...existing, ...incoming];
  const fresh = incoming.filter(row => {
    const ms = parseLiveTimestampMs(row.timestamp);
    return ms != null && ms > lastMs;
  });
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh];
}

export function trimLiveRows(rows: LiveVizRow[], maxPoints: number): LiveVizRow[] {
  if (maxPoints <= 0 || rows.length <= maxPoints) return rows;
  return rows.slice(-maxPoints);
}

export function liveZoomSpanMs(range: { startMs: number; endMs: number } | null): number | null {
  if (!range) return null;
  const span = range.endMs - range.startMs;
  return span > 0 ? span : null;
}

export function shouldFollowLiveTail(
  zoom: { startMs: number; endMs: number } | null,
  dataEndMs: number,
  edgeMs = LIVE_FOLLOW_EDGE_MS,
): boolean {
  if (zoom == null) return true;
  return dataEndMs - zoom.endMs <= edgeMs;
}

export function liveFollowWindow(
  dataStartMs: number,
  dataEndMs: number,
  spanMs: number | null,
): { startMs: number; endMs: number } | null {
  if (!Number.isFinite(dataStartMs) || !Number.isFinite(dataEndMs) || dataEndMs <= dataStartMs) {
    return null;
  }
  if (spanMs == null || spanMs <= 0 || spanMs >= dataEndMs - dataStartMs) {
    return { startMs: dataStartMs, endMs: dataEndMs };
  }
  return {
    startMs: Math.max(dataStartMs, dataEndMs - spanMs),
    endMs: dataEndMs,
  };
}
