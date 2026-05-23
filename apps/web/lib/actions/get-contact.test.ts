import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  contacts: { id: 'id_col' },
  contactIdentities: { id: 'id_col', contactId: 'contact_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));
vi.mock('../audit/with-read-audit', () => ({
  withReadAudit: vi.fn().mockImplementation((_input: unknown, fn: () => unknown) => fn()),
}));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { getContact } from './get-contact';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };
const CONTACT_ID = 'contact-uuid-1';

function makeMockTx(contactRows: unknown[], identityRows: unknown[]) {
  const selectFn = vi.fn();
  selectFn
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(contactRows) }),
      }),
    })
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(identityRows),
      }),
    });
  return { select: selectFn } as never;
}

describe('getContact', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when organization is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);

    expect(await getContact(CONTACT_ID)).toBeNull();
  });

  it('returns null when contact is not found', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx([], [])));

    expect(await getContact(CONTACT_ID)).toBeNull();
  });

  it('returns contact + identities on happy path', async () => {
    const contact = { id: CONTACT_ID, primaryName: 'Alice', primaryEmail: 'alice@example.com' };
    const identities = [
      { id: 'i-1', contactId: CONTACT_ID, kind: 'email', normalizedValue: 'alice@example.com' },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeMockTx([contact], identities)),
    );

    const result = await getContact(CONTACT_ID);
    expect(result?.contact.id).toBe(CONTACT_ID);
    expect(result?.identities).toHaveLength(1);
    expect(result?.identities[0]?.kind).toBe('email');
  });
});
