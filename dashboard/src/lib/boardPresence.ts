export const BOARD_ONLINE_WINDOW_MS = 120_000;

function validMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1)) return null;
  return ms;
}

/** Newer of the heartbeat and the latest UART sample. Firmware skips
 * heartbeats while UART uploads succeed, so the heartbeat alone goes stale. */
export function latestPresenceIso(heartbeat?: string | null, uartAt?: string | null): string {
  const beat = validMs(heartbeat);
  const uart = validMs(uartAt);
  if (uart != null && (beat == null || uart > beat)) return uartAt ?? '';
  return heartbeat ?? '';
}

export function isBoardOnline(
  board: { is_active: boolean; last_heartbeat?: string | null },
  now: number,
  uartAt?: string | null,
): boolean {
  if (!board.is_active) return false;
  const seen = validMs(latestPresenceIso(board.last_heartbeat, uartAt));
  return seen != null && now - seen < BOARD_ONLINE_WINDOW_MS;
}
