import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/contacts', () => ({
  ensureContact: vi.fn(),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn().mockReturnValue({}),
  parties: { id: 'id_col', email: 'email_col', phone: 'phone_col', fullName: 'name_col' },
  communications: { id: 'id_col', fromE164: 'from_col', toE164: 'to_col' },
  emailThreads: {
    id: 'id_col',
    communicationId: 'comm_id_col',
    fromEmail: 'from_col',
    toParticipants: 'to_col',
  },
}));

vi.mock('drizzle-orm', () => ({
  isNotNull: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({
  withRls: vi
    .fn()
    .mockImplementation((_orgId: string, fn: (tx: never) => Promise<unknown>) => fn({} as never)),
}));

import { ensureContact } from '@cema/contacts';

import { withRls } from '../with-rls';

import { backfillContacts } from './backfill';

beforeEach(() => {
  vi.mocked(ensureContact).mockResolvedValue({
    contactId: 'c-1',
    created: true,
    matchedBy: 'created',
  });
});

afterEach(() => vi.clearAllMocks());

function setupTxRows(partyRows: unknown[], commRows: unknown[], threadRows: unknown[]) {
  const selectFn = vi.fn();
  selectFn
    .mockReturnValueOnce({ from: vi.fn().mockResolvedValue(partyRows) })
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(commRows) }),
    })
    .mockReturnValueOnce({ from: vi.fn().mockResolvedValue(threadRows) });
  return { select: selectFn } as never;
}

describe('backfillContacts', () => {
  it('returns all zeros when there is no data', async () => {
    const tx = setupTxRows([], [], []);
    vi.mocked(withRls).mockImplementationOnce(async (_orgId, fn) => fn(tx));
    const stats = await backfillContacts('org-1');
    expect(stats.partiesProcessed).toBe(0);
    expect(stats.commsProcessed).toBe(0);
    expect(stats.emailThreadsProcessed).toBe(0);
    expect(stats.contactsCreated).toBe(0);
  });

  it('processes one party with email + phone', async () => {
    const tx = setupTxRows(
      [{ id: 'p-1', email: 'bob@example.com', phone: '+12125551234', fullName: 'Bob' }],
      [],
      [],
    );
    vi.mocked(withRls).mockImplementationOnce(async (_orgId, fn) => fn(tx));
    const stats = await backfillContacts('org-1');
    expect(stats.partiesProcessed).toBe(1);
    expect(stats.identitiesLinked).toBe(2);
  });

  it('processes email thread participants', async () => {
    const tx = setupTxRows(
      [],
      [],
      [
        {
          id: 't-1',
          communicationId: 'c-1',
          fromEmail: 'sender@example.com',
          toParticipants: [
            { email: 'r1@example.com', name: 'R One' },
            { email: 'r2@example.com', name: 'R Two' },
          ],
        },
      ],
    );
    vi.mocked(withRls).mockImplementationOnce(async (_orgId, fn) => fn(tx));
    const stats = await backfillContacts('org-1');
    expect(stats.emailThreadsProcessed).toBe(1);
    expect(stats.identitiesLinked).toBe(3);
  });
});
