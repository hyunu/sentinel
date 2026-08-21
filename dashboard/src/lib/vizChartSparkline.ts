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
