import { describe, expect, it } from 'vitest';

import { encodeActivityCursor, parseActivityCursor } from './activity-cursor';

describe('activity cursor', () => {
  it('round-trips an occurredAt + id through encode/parse', () => {
    const occurredAt = new Date('2026-06-05T15:30:00.000Z');
    const encoded = encodeActivityCursor({ occurredAt, id: 'abc-123' });
    const parsed = parseActivityCursor(encoded);
    expect(parsed?.occurredAt.toISOString()).toBe('2026-06-05T15:30:00.000Z');
    expect(parsed?.id).toBe('abc-123');
  });

  it('encodes as <ISO>_<id>', () => {
    const encoded = encodeActivityCursor({
      occurredAt: new Date('2026-01-02T03:04:05.678Z'),
      id: 'uuid-1',
    });
    expect(encoded).toBe('2026-01-02T03:04:05.678Z_uuid-1');
  });

  it('returns null for absent input', () => {
    expect(parseActivityCursor(null)).toBeNull();
    expect(parseActivityCursor(undefined)).toBeNull();
  });

  it('returns null for malformed input (no separator, edges, bad date)', () => {
    expect(parseActivityCursor('no-separator-here')).toBeNull();
    expect(parseActivityCursor('_id-only')).toBeNull();
    expect(parseActivityCursor('2026-06-05T15:30:00.000Z_')).toBeNull();
    expect(parseActivityCursor('not-a-date_abc')).toBeNull();
  });

  it('splits on the FIRST separator so an id containing _ survives', () => {
    const parsed = parseActivityCursor('2026-06-05T15:30:00.000Z_weird_id_42');
    expect(parsed?.id).toBe('weird_id_42');
    expect(parsed?.occurredAt.toISOString()).toBe('2026-06-05T15:30:00.000Z');
  });
});
