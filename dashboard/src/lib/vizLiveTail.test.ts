import { describe, expect, it } from 'vitest';
import {
  liveFollowWindow,
  liveZoomSpanMs,
  mergeLiveRows,
  shouldFollowLiveTail,
  trimLiveRows,
} from './vizLiveTail';

describe('mergeLiveRows', () => {
  it('appends only points after the last existing timestamp', () => {
    const existing = [
      { timestamp: '2026-08-23T06:00:00.000Z', values: { rpm: 1 } },
      { timestamp: '2026-08-23T06:00:01.000Z', values: { rpm: 2 } },
    ];
    const incoming = [
      { timestamp: '2026-08-23T06:00:01.000Z', values: { rpm: 2 } },
      { timestamp: '2026-08-23T06:00:02.000Z', values: { rpm: 3 } },
    ];
    expect(mergeLiveRows(existing, incoming)).toEqual([
      existing[0],
      existing[1],
      incoming[1],
    ]);
  });
});

describe('trimLiveRows', () => {
  it('keeps the newest points', () => {
    const rows = [
      { timestamp: '2026-08-23T06:00:00.000Z', values: { rpm: 1 } },
      { timestamp: '2026-08-23T06:00:01.000Z', values: { rpm: 2 } },
      { timestamp: '2026-08-23T06:00:02.000Z', values: { rpm: 3 } },
    ];
    expect(trimLiveRows(rows, 2)).toEqual([rows[1], rows[2]]);
  });
});

describe('live follow window', () => {
  it('keeps the requested span pinned to the newest sample', () => {
    expect(liveFollowWindow(1_000, 10_000, 2_000)).toEqual({
      startMs: 8_000,
      endMs: 10_000,
    });
  });

  it('follows the live edge and pauses when panned away', () => {
    expect(shouldFollowLiveTail({ startMs: 8_000, endMs: 10_000 }, 10_000)).toBe(true);
    expect(shouldFollowLiveTail({ startMs: 1_000, endMs: 3_000 }, 10_000)).toBe(false);
    expect(liveZoomSpanMs({ startMs: 1_000, endMs: 4_000 })).toBe(3_000);
  });
});
