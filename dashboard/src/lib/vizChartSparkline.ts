import { VIZ_SESSION_GAP_MS } from './vizChartConstants';

type SparkPoint = { timeKey: string } & Record<string, string | number>;

export function sparklineMaxValue(point: SparkPoint, itemIds: string[]): number | null {
  let max: number | null = null;
  for (const id of itemIds) {
    const raw = point[id];
    if (typeof raw !== 'number' || Number.isNaN(raw)) continue;
    if (max == null || raw > max) max = raw;
  }
  return max;
}

/** Per time-bin peak values — matches main chart envelope better than point decimation. */
export function computeSparklineValueBins(
  data: SparkPoint[],
  itemIds: string[],
  binCount: number,
): number[] {
  if (data.length === 0 || itemIds.length === 0 || binCount <= 0) return [];

  const startMs = Date.parse(data[0].timeKey);
  const endMs = Date.parse(data[data.length - 1].timeKey);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return new Array(binCount).fill(0);
  }

  const spanMs = endMs - startMs;
  const bins = new Array<number>(binCount).fill(0);
  for (const point of data) {
    const t = Date.parse(point.timeKey);
    if (!Number.isFinite(t)) continue;
    const value = sparklineMaxValue(point, itemIds);
    if (value == null) continue;
    const ratio = Math.max(0, Math.min(1, (t - startMs) / spanMs));
    const idx = Math.min(binCount - 1, Math.floor(ratio * binCount));
    if (value > bins[idx]) bins[idx] = value;
  }
  return bins;
}

export function sparklineValueScaleMax(
  bins: number[],
  valueMaxOverride?: number,
): number {
  if (valueMaxOverride != null && Number.isFinite(valueMaxOverride) && valueMaxOverride > 0) {
    return valueMaxOverride;
  }
  let max = 0;
  for (const v of bins) if (v > max) max = v;
  return max || 1;
}

/** Build SVG polyline point strings; breaks segments at session time gaps. */
export function buildSparklinePolyline(
  data: SparkPoint[],
  itemIds: string[],
  width: number,
  height: number,
  sessionGapMs: number = VIZ_SESSION_GAP_MS,
): string[] {
  if (itemIds.length === 0 || data.length < 2) return [];

  let min = Infinity;
  let max = -Infinity;
  const values: number[] = [];
  const times: number[] = [];
  for (const point of data) {
    const value = sparklineMaxValue(point, itemIds);
    const num = value == null ? NaN : value;
    values.push(num);
    times.push(Date.parse(point.timeKey));
    if (Number.isFinite(num)) {
      if (num < min) min = num;
      if (num > max) max = num;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];

  const startMs = times[0];
  const endMs = times[times.length - 1];
  const spanMs = endMs - startMs;
  if (spanMs <= 0) return [];

  const range = max - min || 1;
  const segments: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length > 1) segments.push(current.join(' '));
    current = [];
  };

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const t = times[i];
    if (!Number.isFinite(value) || !Number.isFinite(t)) {
      flush();
      continue;
    }
    if (i > 0) {
      const prevT = times[i - 1];
      if (Number.isFinite(prevT) && t - prevT >= sessionGapMs) {
        flush();
      }
    }
    const x = ((t - startMs) / spanMs) * width;
    const y = height - ((value - min) / range) * height;
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  flush();
  return segments;
}
