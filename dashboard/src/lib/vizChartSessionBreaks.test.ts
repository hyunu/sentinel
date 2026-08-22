import { describe, expect, it } from 'vitest';
import {
  findSessionBreakTimesFromSpectrum,
  findSessionBreakTimesSec,
  shouldGapLineSegment,
  spectrumBinsForSessionGaps,
} from './vizChartSessionBreaks';

describe('findSessionBreakTimesSec', () => {
  it('returns break at the first point after a gap >= 30s', () => {
    const keys = [
      '2025-08-21T00:00:00.000Z',
      '2025-08-21T00:00:10.000Z',
      '2025-08-21T00:01:00.000Z',
    ];
    const breaks = findSessionBreakTimesSec(keys);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toBe(Date.parse(keys[2]) / 1000);
  });

  it('does not treat downsample spacing within a burst as a session break', () => {
    const keys = [
      '2025-08-21T01:00:00.000Z',
      '2025-08-21T01:00:35.000Z',
      '2025-08-21T01:01:10.000Z',
    ];
    expect(findSessionBreakTimesSec(keys)).toHaveLength(2);
  });
});

describe('findSessionBreakTimesFromSpectrum', () => {
  it('detects a break after 30s+ absent bins', () => {
    const start = '2025-08-21T00:00:00.000Z';
    const end = '2025-08-21T00:05:00.000Z';
    const present = [
      ...Array(10).fill(true),
      false, false,
      ...Array(8).fill(true),
    ];
    const breaks = findSessionBreakTimesFromSpectrum(start, end, present);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toBeCloseTo(Date.parse('2025-08-21T00:03:00.000Z') / 1000, 0);
  });

  it('ignores short absent spans within a session', () => {
    const start = '2025-08-21T00:00:00.000Z';
    const end = '2025-08-21T00:02:00.000Z';
    const present = [
      true, true, true, true, true, true, true, true,
      false,
      true, true, true, true,
    ];
    expect(findSessionBreakTimesFromSpectrum(start, end, present)).toHaveLength(0);
  });
});

describe('spectrumBinsForSessionGaps', () => {
  it('scales bins for an 8-hour chart range', () => {
    expect(spectrumBinsForSessionGaps(8 * 60 * 60 * 1000)).toBe(960);
  });
});

describe('shouldGapLineSegment', () => {
  it('gaps when adjacent points are 30s or more apart', () => {
    const from = Date.parse('2025-08-21T00:00:00.000Z') / 1000;
    const to = Date.parse('2025-08-21T00:00:35.000Z') / 1000;
    expect(shouldGapLineSegment(from, to)).toBe(true);
  });
});
