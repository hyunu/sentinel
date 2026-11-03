export type VizDetailCacheRow = { timestamp: string; values: Record<string, number> };

export type VizDetailCacheMeta = {
  total_matched: number;
  returned: number;
  downsampled: boolean;
};

type DetailCacheEntry = {
  data: VizDetailCacheRow[];
  meta: VizDetailCacheMeta | null;
  fetchedAt: number;
};

const DETAIL_CACHE_MAX = 32;
const DETAIL_CACHE_MAX_ROWS = 100_000;
const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

export function buildDetailCacheKey(
  boardId: string,
  startTs: string,
  endTs: string,
  itemKey: string,
): string {
  return `${boardId}|${startTs}|${endTs}|${itemKey}`;
}

export class VizDetailCache {
  private store = new Map<string, DetailCacheEntry>();
  private totalRows = 0;

  get(key: string): DetailCacheEntry | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    this.store.delete(key);
    this.store.set(key, hit);
    return hit;
  }

  peek(key: string): DetailCacheEntry | undefined {
    return this.store.get(key);
  }

  set(key: string, data: VizDetailCacheRow[], meta: VizDetailCacheMeta | null): void {
    const previous = this.store.get(key);
    if (previous) this.totalRows -= previous.data.length;
    this.store.set(key, { data, meta, fetchedAt: Date.now() });
    this.totalRows += data.length;

    while (
      this.store.size > DETAIL_CACHE_MAX
      || this.totalRows > DETAIL_CACHE_MAX_ROWS
    ) {
      const oldest = this.store.keys().next().value;
      if (!oldest) break;
      const removed = this.store.get(oldest);
      this.totalRows -= removed?.data.length ?? 0;
      this.store.delete(oldest);
    }
  }

  isFresh(entry: DetailCacheEntry): boolean {
    return Date.now() - entry.fetchedAt < DETAIL_CACHE_TTL_MS;
  }

  /** Best cached detail whose time range overlaps [startTs, endTs] (same board + items). */
  findBestOverlap(
    boardId: string,
    startTs: string,
    endTs: string,
    itemKey: string,
  ): DetailCacheEntry | undefined {
    const startMs = Date.parse(startTs);
    const endMs = Date.parse(endTs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined;

    const lo = Math.min(startMs, endMs);
    const hi = Math.max(startMs, endMs);
    const prefix = `${boardId}|`;
    const suffix = `|${itemKey}`;

    let best: { entry: DetailCacheEntry; overlapMs: number } | undefined;

    for (const [key, entry] of this.store) {
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      const middle = key.slice(prefix.length, key.length - suffix.length);
      const pipeIdx = middle.indexOf('|');
      if (pipeIdx < 0) continue;
      const cStartMs = Date.parse(middle.slice(0, pipeIdx));
      const cEndMs = Date.parse(middle.slice(pipeIdx + 1));
      if (!Number.isFinite(cStartMs) || !Number.isFinite(cEndMs)) continue;

      const overlapStart = Math.max(lo, Math.min(cStartMs, cEndMs));
      const overlapEnd = Math.min(hi, Math.max(cStartMs, cEndMs));
      const overlapMs = overlapEnd - overlapStart;
      if (overlapMs <= 0) continue;

      if (!best || overlapMs > best.overlapMs) {
        best = { entry, overlapMs };
      }
    }

    return best?.entry;
  }

  clear(): void {
    this.store.clear();
    this.totalRows = 0;
  }
}
