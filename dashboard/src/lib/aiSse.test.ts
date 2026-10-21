import { describe, expect, it } from 'vitest';
import { extractSSEEvents } from './aiSse';

describe('extractSSEEvents', () => {
  it('returns complete events and keeps an incomplete tail', () => {
    const input = 'data: {"type":"token","content":"a"}\n\ndata: {"type":"token","content":"b"}\n\ndata: {"type":"done"';
    const result = extractSSEEvents(input);
    expect(result.events).toEqual(['{"type":"token","content":"a"}', '{"type":"token","content":"b"}']);
    expect(result.rest).toBe('data: {"type":"done"');
  });

  it('handles CRLF separators', () => {
    const result = extractSSEEvents('data: {"type":"token","content":"a"}\r\n\r\n');
    expect(result.events).toEqual(['{"type":"token","content":"a"}']);
    expect(result.rest).toBe('');
  });

  it('ignores comments and non-data lines', () => {
    const result = extractSSEEvents(': keepalive\nevent: token\ndata: {"type":"token"}\n\n');
    expect(result.events).toEqual(['{"type":"token"}']);
  });

  it('joins multiple data lines in one event', () => {
    const result = extractSSEEvents('data: {"type":"token",\ndata: "content":"a"}\n\n');
    expect(result.events).toEqual(['{"type":"token",\n"content":"a"}']);
  });
});
