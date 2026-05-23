import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  users: {},
  parties: { id: 'p_id_col', dealId: 'p_deal_id_col' },
  deals: { id: 'd_id_col', organizationId: 'd_org_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/kg', () => ({
  addEdge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { addEdge } from '@cema/kg';
import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { linkContactToParty } from './link-contact-to-party';

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };
const PARTY = { id: 'party-1', dealId: 'deal-1' };

function makeDb() {
  return {
    query: {
      organizations: { findFirst: vi.fn().mockResolvedValue(ORG) },
      users: {
        findFirst: vi.fn().mockResolvedValue({ id: 'user-1', clerkUserId: 'clerk-user-1' }),
      },
    },
  } as unknown as ReturnType<typeof getDb>;
}

function makeTxWith(partyRow: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(partyRow ? [partyRow] : []),
        }),
      }),
    }),
  } as never;
}

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue(makeDb());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('linkContactToParty', () => {
  it('throws when party is not found', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith(null)));
    await expect(linkContactToParty('contact-1', 'party-99')).rejects.toThrow('Party not found');
  });

  it('calls addEdge twice (contact→party and party→deal) on happy path', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith(PARTY)));
    await linkContactToParty('contact-1', 'party-1');
    expect(addEdge).toHaveBeenCalledTimes(2);
  });

  it('returns edge counts on success', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith(PARTY)));
    const result = await linkContactToParty('contact-1', 'party-1');
    expect(result).toEqual({
      edgesCreated: 2,
      contactId: 'contact-1',
      partyId: 'party-1',
      dealId: 'deal-1',
    });
  });
});
