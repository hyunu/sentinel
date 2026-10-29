import { describe, expect, it } from 'vitest';
import { FULL_LOAD_MAX_POINTS, shouldFullLoadInMemory } from './vizFullLoad';

const sample = [
  { timestamp: '2026-10-29T00:00:00Z', values: { temperature: 25 } },
  { timestamp: '2026-10-29T00:01:00Z', values: { temperature: 26 } },
];

describe('shouldFullLoadInMemory', () => {
  it('rejects large series even when the estimated byte size is small', () => {
    const meta = {
      total_matched: 120_758,
      returned: 2_516,
      downsampled: true,
    };
    expect(shouldFullLoadInMemory(meta, sample)).toBe(false);
  });

  it('allows a small downsampled series', () => {
    const meta = {
      total_matched: 15_000,
      returned: 2_000,
      downsampled: true,
    };
    expect(meta.total_matched).toBeLessThanOrEqual(FULL_LOAD_MAX_POINTS);
    expect(shouldFullLoadInMemory(meta, sample)).toBe(true);
  });

  it('rejects series beyond the point cap', () => {
    const meta = {
      total_matched: FULL_LOAD_MAX_POINTS + 1,
      returned: 2_000,
      downsampled: true,
    };
    expect(shouldFullLoadInMemory(meta, sample)).toBe(false);
  });

  it('does not full-load an already complete series', () => {
    expect(shouldFullLoadInMemory({ total_matched: 10, returned: 10, downsampled: false }, sample)).toBe(false);
  });
});
