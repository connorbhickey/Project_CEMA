import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  contacts: { id: 'id_col' },
  contactIdentities: { contactId: 'contact_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/compliance', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { emitAuditEvent } from '@cema/compliance';
import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { mergeContacts } from './merge-contacts';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };
const WINNER_ID = 'contact-winner-1';
const LOSER_ID = 'contact-loser-1';

function makeMockTx(
  winnerRow: unknown,
  loserRow: unknown,
  updateRowCount: number,
): ReturnType<typeof vi.fn> {
  const selectFn = vi.fn();
  // First select: winner; second select: loser
  selectFn
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([winnerRow]) }),
      }),
    })
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([loserRow]) }),
      }),
    });
  const updateFn = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: updateRowCount }),
    }),
  });
  const deleteFn = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
  return { select: selectFn, update: updateFn, delete: deleteFn } as unknown as ReturnType<
    typeof vi.fn
  >;
}

describe('mergeContacts', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws when winner and loser are the same contact', async () => {
    await expect(mergeContacts('same-id', 'same-id')).rejects.toThrow(
      'Cannot merge a contact into itself',
    );
  });

  it('throws when organization is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);

    await expect(mergeContacts(WINNER_ID, LOSER_ID)).rejects.toThrow('Organization not found');
  });

  it('merges identities and emits audit event on happy path', async () => {
    const winner = { id: WINNER_ID, primaryName: 'Alice' };
    const loser = { id: LOSER_ID, primaryName: 'Al' };
    const tx = makeMockTx(winner, loser, 2);
    vi.mocked(withRls).mockImplementationOnce(async (_orgId, fn) => fn(tx as never));

    const result = await mergeContacts(WINNER_ID, LOSER_ID);

    expect(result.winnerContactId).toBe(WINNER_ID);
    expect(result.loserContactId).toBe(LOSER_ID);
    expect(result.movedIdentities).toBe(2);
    expect(emitAuditEvent).toHaveBeenCalledOnce();
  });
});
