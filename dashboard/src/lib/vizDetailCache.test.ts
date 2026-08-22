import { describe, expect, it } from 'vitest';
import { buildDetailCacheKey, VizDetailCache } from './vizDetailCache';

describe('VizDetailCache', () => {
  const boardId = 'board-1';
  const itemKey = 'a:1:f:1|b:2:g:0';
  const startA = '2026-06-22T10:00:00.000Z';
  const endA = '2026-06-22T10:10:00.000Z';
  const startB = '2026-06-22T10:05:00.000Z';
  const endB = '2026-06-22T10:15:00.000Z';

  it('finds the cache entry with the largest overlap', () => {
    const cache = new VizDetailCache();
    const keyA = buildDetailCacheKey(boardId, startA, endA, itemKey);
    const keyB = buildDetailCacheKey(boardId, startB, endB, itemKey);
    cache.set(keyA, [{ timestamp: startA, values: {} }], null);
    cache.set(keyB, [{ timestamp: startB, values: {} }], null);

    const hit = cache.findBestOverlap(
      boardId,
      '2026-06-22T10:04:00.000Z',
      '2026-06-22T10:12:00.000Z',
      itemKey,
    );

    expect(hit?.data[0]?.timestamp).toBe(startB);
  });

  it('ignores entries for other boards or item sets', () => {
    const cache = new VizDetailCache();
    cache.set(
      buildDetailCacheKey(boardId, startA, endA, itemKey),
      [{ timestamp: startA, values: {} }],
      null,
    );

    expect(cache.findBestOverlap('other', startA, endA, itemKey)).toBeUndefined();
    expect(cache.findBestOverlap(boardId, startA, endA, 'other-key')).toBeUndefined();
  });
});
