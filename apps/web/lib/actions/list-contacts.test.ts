import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  contacts: { id: 'id_col', createdAt: 'created_at_col' },
  contactIdentities: { id: 'id_col', contactId: 'contact_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  sql: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { listContacts } from './list-contacts';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };

function makeMockTx(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) }),
        }),
      }),
    }),
  } as never;
}

describe('listContacts', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when organization is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);

    expect(await listContacts()).toEqual([]);
  });

  it('returns contacts with identity counts on happy path', async () => {
    const rows = [
      { contact: { id: 'c-1', primaryName: 'Alice' }, identityCount: 2 },
      { contact: { id: 'c-2', primaryName: 'Bob' }, identityCount: 1 },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows)));

    const result = await listContacts();
    expect(result).toHaveLength(2);
    expect(result[0]?.contact.id).toBe('c-1');
    expect(result[0]?.identityCount).toBe(2);
  });

  it('returns empty array when org has no contacts', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx([])));

    const result = await listContacts();
    expect(result).toHaveLength(0);
  });
});
