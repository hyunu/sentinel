/**
 * Extract complete Server-Sent Events payloads from a streaming buffer.
 * Returns the payload strings and the incomplete tail that must be kept for
 * the next read. Multiple `data:` lines in one event are joined with "\n".
 */
export function extractSSEEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buffer;

  while (true) {
    const match = /\r?\n\r?\n/.exec(rest);
    if (!match || match.index === undefined) break;

    const chunk = rest.slice(0, match.index);
    rest = rest.slice(match.index + match[0].length);

    const dataLines: string[] = [];
    for (const rawLine of chunk.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length > 0) {
      events.push(dataLines.join('\n'));
    }
  }

  return { events, rest };
}
