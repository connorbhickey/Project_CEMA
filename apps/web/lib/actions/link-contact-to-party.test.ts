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
  contacts: { id: 'c_id_col', primaryEmail: 'c_email_col', primaryPhone: 'c_phone_col' },
  contactIdentities: {},
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
const CONTACT_WITH_BOTH = { primaryEmail: 'alice@example.com', primaryPhone: '+12125550001' };
const CONTACT_EMAIL_ONLY = { primaryEmail: 'bob@example.com', primaryPhone: null };
const CONTACT_NO_IDENTITY = { primaryEmail: null, primaryPhone: null };

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

function makeTxWith(partyRow: unknown, contactRow: unknown) {
  const selectMock = vi.fn();
  // First call: .select().from(parties).innerJoin(deals).where() → party
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(partyRow ? [partyRow] : []),
      }),
    }),
  });
  // Second call: .select().from(contacts).where().limit() → contact
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(contactRow ? [contactRow] : []),
      }),
    }),
  });
  const insertMock = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    }),
  });
  return { select: selectMock, insert: insertMock } as never;
}

/** Extracts the array passed to `.values()` on the first `.insert()` call of `tx`. */
function getInsertedValues(tx: ReturnType<typeof makeTxWith>): unknown[] {
  const insertFn = tx.insert as ReturnType<typeof vi.fn>;
  // The mock chain is: insert(table) → { values(rows) → { onConflictDoNothing() } }
  // We pull `values` off the recorded return value of the first insert call.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const returnVal: { values: ReturnType<typeof vi.fn> } = insertFn.mock.results[0].value as {
    values: ReturnType<typeof vi.fn>;
  };
  return returnVal.values.mock.calls[0][0] as unknown[];
}

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue(makeDb());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('linkContactToParty', () => {
  it('throws when party is not found', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith(null, null)));
    await expect(linkContactToParty('contact-1', 'party-99')).rejects.toThrow('Party not found');
  });

  it('calls addEdge twice (contact→party and party→deal) on happy path', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith(PARTY, CONTACT_NO_IDENTITY)),
    );
    await linkContactToParty('contact-1', 'party-1');
    expect(addEdge).toHaveBeenCalledTimes(2);
  });

  it('returns edge counts on success', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith(PARTY, CONTACT_NO_IDENTITY)),
    );
    const result = await linkContactToParty('contact-1', 'party-1');
    expect(result).toEqual({
      edgesCreated: 2,
      contactId: 'contact-1',
      partyId: 'party-1',
      dealId: 'deal-1',
    });
  });

  it('upserts email and phone identity rows when contact has both', async () => {
    const tx = makeTxWith(PARTY, CONTACT_WITH_BOTH);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(tx));
    await linkContactToParty('contact-1', 'party-1');
    expect(tx.insert).toHaveBeenCalledOnce();
    const insertedValues = getInsertedValues(tx);
    expect(insertedValues).toHaveLength(2);
    expect(insertedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'email', normalizedValue: 'alice@example.com' }),
        expect.objectContaining({ kind: 'phone', normalizedValue: '+12125550001' }),
      ]),
    );
  });

  it('upserts only email identity when contact has no phone', async () => {
    const tx = makeTxWith(PARTY, CONTACT_EMAIL_ONLY);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(tx));
    await linkContactToParty('contact-1', 'party-1');
    expect(tx.insert).toHaveBeenCalledOnce();
    const insertedValues = getInsertedValues(tx);
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({ kind: 'email', normalizedValue: 'bob@example.com' });
  });

  it('skips insert entirely when contact has no email or phone', async () => {
    const tx = makeTxWith(PARTY, CONTACT_NO_IDENTITY);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(tx));
    await linkContactToParty('contact-1', 'party-1');
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
