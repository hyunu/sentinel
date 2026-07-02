/** Format as yyyy-MM-dd HH:mm:ss (local time). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return formatDateTimeFromDate(d);
}

/** Format Date as yyyy-MM-dd HH:mm:ss (local time). */
export function formatDateTimeFromDate(d: Date): string {
  if (Number.isNaN(d.getTime()) || d.getTime() <= 0) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format as mm/dd HH:mm:ss (local time) for chart axes and tooltips. */
export function formatChartAxisTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format elapsed milliseconds for chart time-range measurement. */
export function formatTimeInterval(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(abs)}ms`;
  const sec = abs / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  if (min < 60) return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
  const hour = Math.floor(min / 60);
  const remMin = min % 60;
  if (hour < 24) return remMin > 0 ? `${hour}h ${remMin}m` : `${hour}h`;
  const day = Math.floor(hour / 24);
  const remHour = hour % 24;
  return remHour > 0 ? `${day}d ${remHour}h` : `${day}d`;
}

/** Parse yyyy-MM-dd HH:mm:ss (or yyyy-MM-ddTHH:mm[:ss]) into local Date. */
export function parseDateTime(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    const date = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s ?? 0),
    );
    if (
      date.getFullYear() !== Number(y)
      || date.getMonth() !== Number(mo) - 1
      || date.getDate() !== Number(d)
    ) {
      return null;
    }
    return date;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}
