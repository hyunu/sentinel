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

  get(key: string): DetailCacheEntry | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    this.store.delete(key);
    this.store.set(key, hit);
    return hit;
  }

  set(key: string, data: VizDetailCacheRow[], meta: VizDetailCacheMeta | null): void {
    this.store.set(key, { data, meta, fetchedAt: Date.now() });
    while (this.store.size > DETAIL_CACHE_MAX) {
      const oldest = this.store.keys().next().value;
      if (!oldest) break;
      this.store.delete(oldest);
    }
  }

  isFresh(entry: DetailCacheEntry): boolean {
    return Date.now() - entry.fetchedAt < DETAIL_CACHE_TTL_MS;
  }

  clear(): void {
    this.store.clear();
  }
}
