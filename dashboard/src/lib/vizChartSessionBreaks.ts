import { VIZ_SESSION_GAP_SECONDS } from './vizChartConstants';

/** Seconds (uPlot x scale) where a new data segment starts after a gap with no samples. */
export function findSessionBreakTimesSec(timeKeys: readonly string[]): number[] {
  if (timeKeys.length < 2) return [];
  const breaks: number[] = [];
  for (let i = 0; i < timeKeys.length - 1; i++) {
    const a = Date.parse(timeKeys[i]) / 1000;
    const b = Date.parse(timeKeys[i + 1]) / 1000;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (b - a >= VIZ_SESSION_GAP_SECONDS) {
      breaks.push(b);
    }
  }
  return breaks;
}

/**
 * Session breaks from data-presence bins (spectrum API).
 * Detects spans of at least gapSec where no samples exist in MongoDB.
 */
export function findSessionBreakTimesFromSpectrum(
  startIso: string,
  endIso: string,
  present: readonly boolean[],
  gapSec: number = VIZ_SESSION_GAP_SECONDS,
): number[] {
  if (present.length === 0) return [];
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const spanMs = endMs - startMs;
  const stepMs = spanMs / present.length;
  const gapMs = gapSec * 1000;
  const breaks: number[] = [];

  let lastPresentIdx = -1;
  for (let i = 0; i < present.length; i++) {
    if (!present[i]) continue;
    if (lastPresentIdx >= 0) {
      const absentStartMs = startMs + (lastPresentIdx + 1) * stepMs;
      const absentEndMs = startMs + i * stepMs;
      if (absentEndMs - absentStartMs >= gapMs) {
        breaks.push(absentEndMs / 1000);
      }
    }
    lastPresentIdx = i;
  }
  return breaks;
}

/** Bin count for spectrum queries — one bin must not exceed the session gap width. */
export function spectrumBinsForSessionGaps(spanMs: number, maxBins = 2000, minBins = 160): number {
  if (spanMs <= 0) return minBins;
  const needed = Math.ceil(spanMs / (VIZ_SESSION_GAP_SECONDS * 1000));
  return Math.min(maxBins, Math.max(minBins, needed));
}

/**
 * Gap threshold for line segments in the currently plotted data.
 * Downsampled series can legitimately be 60s apart; using the fixed 30s
 * session threshold would break every segment and turn the chart into dots.
 */
export function chartSessionGapThresholdSec(timeKeys: readonly string[]): number {
  const intervals: number[] = [];
  for (let i = 0; i < timeKeys.length - 1; i++) {
    const a = Date.parse(timeKeys[i]) / 1000;
    const b = Date.parse(timeKeys[i + 1]) / 1000;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const delta = b - a;
    if (delta > 0) intervals.push(delta);
  }
  if (intervals.length === 0) return VIZ_SESSION_GAP_SECONDS;
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  return Math.max(VIZ_SESSION_GAP_SECONDS, median * 2.5);
}

export function hasSessionBreakBetween(
  fromSec: number,
  toSec: number,
  breakTimesSec: readonly number[],
): boolean {
  if (toSec <= fromSec || breakTimesSec.length === 0) return false;
  for (const t of breakTimesSec) {
    if (t <= fromSec) continue;
    if (t <= toSec) return true;
    return false;
  }
  return false;
}

/** True when no samples exist for at least sessionGapSec between two timestamps. */
export function shouldGapLineSegment(
  fromSec: number,
  toSec: number,
  breakTimesSec: readonly number[] = [],
  sessionGapSec: number = VIZ_SESSION_GAP_SECONDS,
): boolean {
  if (toSec - fromSec >= sessionGapSec) return true;
  return hasSessionBreakBetween(fromSec, toSec, breakTimesSec);
}
