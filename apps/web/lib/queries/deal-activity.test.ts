import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  communications: {},
  documents: {},
  emailThreads: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
}));

import { getDb } from '@cema/db';

import { getDealActivity } from './deal-activity';

function makeDb(comms: unknown[], docs: unknown[]) {
  let callCount = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      callCount++;
      const row = callCount === 1 ? comms : docs;
      return {
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(row),
              }),
            }),
          }),
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(row),
            }),
          }),
        }),
      };
    }),
  };
}

describe('getDealActivity', () => {
  it('returns merged events sorted by time descending', async () => {
    const comm = { id: 'c1', kind: 'call', occurredAt: new Date('2026-05-10'), subject: null };
    const doc = {
      id: 'd1',
      kind: 'cema_3172',
      occurredAt: new Date('2026-05-11'),
    };
    vi.mocked(getDb).mockReturnValue(makeDb([comm], [doc]) as never);

    const events = await getDealActivity('deal-1');
    // doc (May 11) should come before comm (May 10) in desc order
    expect(events[0]!.id).toBe('d1');
    expect(events[1]!.id).toBe('c1');
  });

  it('returns null detail for document events (no filename column on documents)', async () => {
    const doc = { id: 'd1', kind: 'cema_3172', occurredAt: new Date('2026-05-11') };
    vi.mocked(getDb).mockReturnValue(makeDb([], [doc]) as never);
    const events = await getDealActivity('deal-1');
    expect(events[0]?.type).toBe('document');
    expect(events[0]?.detail).toBeNull();
  });

  it('returns empty array when deal has no events', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([], []) as never);
    const events = await getDealActivity('deal-1');
    expect(events).toHaveLength(0);
  });

  it('each event has type, id, occurredAt, and label', async () => {
    const comm = {
      id: 'c1',
      kind: 'email',
      occurredAt: new Date('2026-05-10'),
      subject: 'Re: payoff',
    };
    vi.mocked(getDb).mockReturnValue(makeDb([comm], []) as never);
    const events = await getDealActivity('deal-1');
    const event = events[0];
    expect(event?.type).toBe('communication');
    expect(event?.id).toBe('c1');
    expect(typeof event?.label).toBe('string');
    expect(event?.occurredAt).toBeInstanceOf(Date);
  });
});
