import { afterEach, describe, expect, it, vi } from 'vitest';

// Verifies the createDeal Server Action's `deal.created` audit metadata is
// PII-safe (hard rule #3): the enum `cemaType` token only, never the
// principal/upb dollar figures. The pure schema is covered in create-deal.test.ts.

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  deals: {},
  existingLoans: {},
  newLoans: {},
  organizations: {},
  properties: {},
  users: {},
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn().mockReturnValue({}) }));
vi.mock('@cema/compliance', () => ({ emitAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Post-commit best-effort notification — irrelevant here, mock to a no-op.
vi.mock('../agents/internal-comms/notify-internal', () => ({
  notifyInternalDealCreated: vi.fn().mockResolvedValue(undefined),
}));

// withRls runs its callback with the throwaway tx below.
vi.mock('../with-rls', () => ({
  withRls: vi.fn((_orgId: string, cb: (tx: unknown) => unknown) => cb(makeTx())),
}));

import { emitAuditEvent } from '@cema/compliance';
import { getDb } from '@cema/db';

import { createDeal } from './create-deal';

// One tx whose every insert().values() both resolves (existingLoans awaits it
// directly) AND offers .returning() (properties/newLoans/deals destructure a row).
function makeTx() {
  const valuesResult = {
    returning: vi.fn().mockResolvedValue([{ id: 'row-1' }]),
    then: (onFulfilled: (v: unknown) => unknown) => onFulfilled([{ id: 'row-1' }]),
  };
  return {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue(valuesResult) }),
  };
}

const VALID_INPUT = {
  cemaType: 'refi_cema',
  propertyType: 'one_family',
  streetAddress: '123 Main St',
  city: 'Brooklyn',
  county: 'Kings',
  zipCode: '11201',
  principal: '500000',
  program: 'conventional_fannie',
  upb: '420000',
};

afterEach(() => vi.clearAllMocks());

describe('createDeal — deal.created audit metadata', () => {
  it('records ONLY the cemaType token — no principal/upb dollar figures (hard rule #3)', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: { findFirst: vi.fn().mockResolvedValue({ id: 'org-1' }) },
        users: { findFirst: vi.fn().mockResolvedValue({ id: 'user-1' }) },
      },
    } as unknown as ReturnType<typeof getDb>);

    await createDeal(VALID_INPUT);

    expect(emitAuditEvent).toHaveBeenCalledTimes(1);
    const [, event] = vi.mocked(emitAuditEvent).mock.calls[0]!;
    expect(event).toMatchObject({ action: 'deal.created', entityType: 'deal' });
    // The metadata is exactly the cemaType token — assert no amount leaked in.
    expect(event.metadata).toEqual({ cemaType: 'refi_cema' });
    expect(event.metadata).not.toHaveProperty('principal');
    expect(event.metadata).not.toHaveProperty('upb');
  });
});
