import { describe, expect, it } from 'vitest';
import { isBoardOnline, latestPresenceIso } from './boardPresence';

const now = Date.parse('2026-11-05T08:44:00.000Z');

describe('board presence', () => {
  it('treats a fresh UART sample as online when the heartbeat is stale', () => {
    const board = {
      is_active: true,
      last_heartbeat: '2026-11-05T08:34:10.587Z',
    };
    const uartAt = '2026-11-05T08:44:05.777Z';
    expect(isBoardOnline(board, now)).toBe(false);
    expect(isBoardOnline(board, now, uartAt)).toBe(true);
    expect(latestPresenceIso(board.last_heartbeat, uartAt)).toBe(uartAt);
  });

  it('stays offline when neither signal is recent', () => {
    const board = {
      is_active: true,
      last_heartbeat: '2026-11-02T09:16:23.194Z',
    };
    expect(isBoardOnline(board, now, '2026-11-03T05:36:42.356Z')).toBe(false);
  });

  it('ignores an inactive board and a zero heartbeat', () => {
    expect(isBoardOnline({
      is_active: false,
      last_heartbeat: '2026-11-05T08:44:00.000Z',
    }, now, '2026-11-05T08:44:00.000Z')).toBe(false);
    expect(latestPresenceIso('0001-01-01T00:00:00Z', '2026-11-05T08:44:05.777Z'))
      .toBe('2026-11-05T08:44:05.777Z');
  });
});
