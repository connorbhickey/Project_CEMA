import { describe, expect, it } from 'vitest';

import { encodeActivityCursor, parseActivityCursor } from './activity-cursor';

describe('activity cursor', () => {
  const UUID = '123e4567-e89b-42d3-a456-426614174000';

  it('round-trips an occurredAt + id through encode/parse', () => {
    const occurredAt = new Date('2026-06-05T15:30:00.000Z');
    const encoded = encodeActivityCursor({ occurredAt, id: UUID });
    const parsed = parseActivityCursor(encoded);
    expect(parsed?.occurredAt.toISOString()).toBe('2026-06-05T15:30:00.000Z');
    expect(parsed?.id).toBe(UUID);
  });

  it('accepts any canonical UUID shape, not only RFC-4122 v4 (Postgres does too)', () => {
    // all-zeros / non-v4-version uuids are valid Postgres uuids (the integration
    // fixtures use them); the parser must not reject them.
    expect(
      parseActivityCursor('2026-06-05T15:30:00.000Z_00000000-0000-0000-0000-0000000000b6')?.id,
    ).toBe('00000000-0000-0000-0000-0000000000b6');
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

  it('returns null when the id is not a UUID (untrusted cursor must not reach the uuid DB column)', () => {
    // A non-UUID id would otherwise flow into lt(auditEvents.id, cursor.id) and
    // throw a Postgres "invalid input syntax for type uuid" (500) instead of
    // degrading to the first page.
    expect(parseActivityCursor('2026-06-05T15:30:00.000Z_not-a-uuid')).toBeNull();
    expect(parseActivityCursor('2026-06-05T15:30:00.000Z_weird_id_42')).toBeNull();
    expect(parseActivityCursor("2026-06-05T15:30:00.000Z_'; DROP TABLE")).toBeNull();
  });
});
