import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/contacts', () => ({
  normalizeEmail: vi.fn((s: string | null | undefined) => (s ? s.toLowerCase() : null)),
  normalizePhone: vi.fn((s: string | null | undefined) => (s ? s : null)),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  contacts: { id: 'id_col' },
  contactIdentities: {
    contactId: 'cid_col',
    organizationId: 'org_col',
    normalizedValue: 'val_col',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue({}),
  eq: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { listContactSuggestions } from './list-contact-suggestions';

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({
    query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
  } as unknown as ReturnType<typeof getDb>);
});

afterEach(() => vi.clearAllMocks());

describe('listContactSuggestions', () => {
  it('returns [] when both emails and phones are empty', async () => {
    const res = await listContactSuggestions({});
    expect(res).toEqual([]);
  });

  it('returns [] when no identity matches the inputs', async () => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };
    vi.mocked(withRls).mockImplementationOnce(async (_orgId, fn) => fn(tx as never));
    const res = await listContactSuggestions({ emails: ['bob@example.com'] });
    expect(res).toEqual([]);
  });

  it('returns contacts when identity matches exist', async () => {
    let selectCallCount = 0;
    const tx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount += 1;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ contactId: 'c-1' }, { contactId: 'c-1' }]),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi
              .fn()
              .mockResolvedValue([{ id: 'c-1', organizationId: 'org-1', primaryName: 'Bob' }]),
          }),
        };
      }),
    };
    vi.mocked(withRls).mockImplementationOnce(async (_orgId, fn) => fn(tx as never));
    const res = await listContactSuggestions({ emails: ['bob@example.com'] });
    expect(res).toHaveLength(1);
  });
});
