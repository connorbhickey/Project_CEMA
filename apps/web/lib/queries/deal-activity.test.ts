import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  communications: { id: 'c_id', kind: 'c_kind', startedAt: 'c_started', dealId: 'c_deal' },
  documents: { id: 'd_id', kind: 'd_kind', createdAt: 'd_created', dealId: 'd_deal' },
  emailThreads: { communicationId: 'e_comm', subject: 'e_subject' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
  lt: vi.fn().mockReturnValue({}),
  or: vi.fn().mockReturnValue({}),
  sql: vi.fn().mockReturnValue({}),
}));

import { getDb } from '@cema/db';

import { getDealActivity } from './deal-activity';

type CommRow = { id: string; kind: string; occurredAt: Date | null; subject: string | null };
type DocRow = { id: string; kind: string; occurredAt: Date };

/**
 * Discriminates the comms vs docs sub-query by the SELECT projection (only the
 * comms projection has `subject`), so the mock is robust to call order and to a
 * type filter skipping one query entirely.
 */
function makeDb(comms: CommRow[], docs: DocRow[]) {
  const commsLimit = vi.fn().mockResolvedValue(comms);
  const docsLimit = vi.fn().mockResolvedValue(docs);
  return {
    commsLimit,
    docsLimit,
    select: vi.fn().mockImplementation((proj: unknown) => {
      const isComms = typeof proj === 'object' && proj !== null && 'subject' in proj;
      const limit = isComms ? commsLimit : docsLimit;
      const tail = { orderBy: vi.fn().mockReturnValue({ limit }) };
      return {
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(tail) }),
          where: vi.fn().mockReturnValue(tail),
        }),
      };
    }),
  };
}

describe('getDealActivity', () => {
  it('returns merged events sorted by time descending', async () => {
    const comm: CommRow = {
      id: 'c1',
      kind: 'call',
      occurredAt: new Date('2026-05-10'),
      subject: null,
    };
    const doc: DocRow = { id: 'd1', kind: 'cema_3172', occurredAt: new Date('2026-05-11') };
    vi.mocked(getDb).mockReturnValue(makeDb([comm], [doc]) as never);

    const { items, nextCursor } = await getDealActivity('deal-1');
    // doc (May 11) should come before comm (May 10) in desc order
    expect(items[0]!.id).toBe('d1');
    expect(items[1]!.id).toBe('c1');
    expect(nextCursor).toBeNull(); // only 2 rows < LIMIT
  });

  it('returns null detail for document events (no filename column on documents)', async () => {
    const doc: DocRow = { id: 'd1', kind: 'cema_3172', occurredAt: new Date('2026-05-11') };
    vi.mocked(getDb).mockReturnValue(makeDb([], [doc]) as never);
    const { items } = await getDealActivity('deal-1');
    expect(items[0]?.type).toBe('document');
    expect(items[0]?.detail).toBeNull();
  });

  it('returns empty items + null cursor when deal has no events', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([], []) as never);
    const { items, nextCursor } = await getDealActivity('deal-1');
    expect(items).toHaveLength(0);
    expect(nextCursor).toBeNull();
  });

  it('each event has type, id, occurredAt, and label', async () => {
    const comm: CommRow = {
      id: 'c1',
      kind: 'email',
      occurredAt: new Date('2026-05-10'),
      subject: 'Re: payoff',
    };
    vi.mocked(getDb).mockReturnValue(makeDb([comm], []) as never);
    const { items } = await getDealActivity('deal-1');
    const event = items[0];
    expect(event?.type).toBe('communication');
    expect(event?.id).toBe('c1');
    expect(typeof event?.label).toBe('string');
    expect(event?.occurredAt).toBeInstanceOf(Date);
  });

  it('type=document runs only the documents sub-query (comms skipped)', async () => {
    const comm: CommRow = {
      id: 'c1',
      kind: 'call',
      occurredAt: new Date('2026-05-10'),
      subject: null,
    };
    const doc: DocRow = { id: 'd1', kind: 'cema_3172', occurredAt: new Date('2026-05-11') };
    const db = makeDb([comm], [doc]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const { items } = await getDealActivity('deal-1', { type: 'document' });
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('document');
    // the comms sub-query is never awaited under a document filter
    expect(db.commsLimit).not.toHaveBeenCalled();
    expect(db.docsLimit).toHaveBeenCalledOnce();
  });

  it('type=communication runs only the communications sub-query (docs skipped)', async () => {
    const comm: CommRow = {
      id: 'c1',
      kind: 'call',
      occurredAt: new Date('2026-05-10'),
      subject: null,
    };
    const doc: DocRow = { id: 'd1', kind: 'cema_3172', occurredAt: new Date('2026-05-11') };
    const db = makeDb([comm], [doc]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const { items } = await getDealActivity('deal-1', { type: 'communication' });
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('communication');
    expect(db.docsLimit).not.toHaveBeenCalled();
    expect(db.commsLimit).toHaveBeenCalledOnce();
  });

  it('emits a nextCursor when the merged page exceeds LIMIT', async () => {
    // 201 docs > LIMIT(200) -> hasMore -> cursor points at the 200th item.
    const docs: DocRow[] = Array.from({ length: 201 }, (_, i) => ({
      id: `d-${String(i).padStart(4, '0')}`,
      kind: 'cema_3172',
      occurredAt: new Date(2026, 0, 1, 0, 0, i), // strictly increasing
    }));
    vi.mocked(getDb).mockReturnValue(makeDb([], docs) as never);

    const { items, nextCursor } = await getDealActivity('deal-1', { type: 'document' });
    expect(items).toHaveLength(200);
    expect(nextCursor).not.toBeNull();
    // cursor encodes the last (oldest shown) item: `<ISO>_<id>`
    const last = items[items.length - 1]!;
    expect(nextCursor).toBe(`${last.occurredAt.toISOString()}_${last.id}`);
  });
});
