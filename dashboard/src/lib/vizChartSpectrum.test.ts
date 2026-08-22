import { describe, expect, it } from 'vitest';
import { spectrumBinRangeToTimeRange } from './vizChartSpectrum';

describe('spectrumBinRangeToTimeRange', () => {
  const startMs = Date.parse('2025-08-21T00:00:00.000Z');
  const endMs = Date.parse('2025-08-21T10:00:00.000Z');
  const bins = 10;

  it('maps a single bin to one tenth of the span', () => {
    const range = spectrumBinRangeToTimeRange(0, 0, startMs, endMs, bins);
    expect(range).not.toBeNull();
    expect(range!.startMs).toBe(startMs);
    expect(range!.endMs).toBe(startMs + (endMs - startMs) / bins);
  });

  it('maps multiple bins inclusively', () => {
    const range = spectrumBinRangeToTimeRange(2, 4, startMs, endMs, bins);
    expect(range).not.toBeNull();
    expect(range!.startMs).toBe(startMs + (endMs - startMs) * 0.2);
    expect(range!.endMs).toBe(startMs + (endMs - startMs) * 0.5);
  });

  it('normalizes reversed indices', () => {
    const forward = spectrumBinRangeToTimeRange(1, 3, startMs, endMs, bins);
    const reversed = spectrumBinRangeToTimeRange(3, 1, startMs, endMs, bins);
    expect(reversed).toEqual(forward);
  });
});
