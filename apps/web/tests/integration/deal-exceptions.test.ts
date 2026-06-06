import { deals, getDb, organizations, parties, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'dxc_org_a';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
}));

const { getDealExceptions } = await import('../../lib/agents/exception-triage/get-deal-exceptions');

// Distinctive `dXc…` ("deal exceptions") namespace.
const ORG_A = 'dece0000-0000-0000-0000-000000000001';
const ORG_B = 'dece0000-0000-0000-0000-000000000002';
const USER_A = 'dece0000-0000-0000-0000-000000000003';
const DEAL_PURCHASE = 'dece0000-0000-0000-0000-00000000000a'; // purchase, active, no seller
const DEAL_CLEAN = 'dece0000-0000-0000-0000-00000000000c'; // refi, no signals

describe.skipIf(skip)('getDealExceptions (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'dxc_org_a', name: 'DXC A', slug: 'dxc-a' },
        { id: ORG_B, clerkOrgId: 'dxc_org_b', name: 'DXC B', slug: 'dxc-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'dxc_user_a', email: 'dxc-a@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values([
        {
          id: DEAL_PURCHASE,
          organizationId: ORG_A,
          cemaType: 'purchase_cema',
          status: 'title_work',
          createdById: USER_A,
        },
        {
          id: DEAL_CLEAN,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'title_work',
          createdById: USER_A,
        },
      ])
      .onConflictDoNothing();
    await db.delete(parties).where(eq(parties.dealId, DEAL_PURCHASE));
  });

  afterAll(async () => {
    await getDb().delete(parties).where(eq(parties.dealId, DEAL_PURCHASE));
  });

  it('flags a Purchase CEMA in an active stage with no seller', async () => {
    currentClerkOrgId = 'dxc_org_a';
    const ex = await getDealExceptions(DEAL_PURCHASE);
    expect(ex.map((e) => e.kind)).toContain('purchase_missing_seller');
  });

  it('clears once a seller party is added', async () => {
    currentClerkOrgId = 'dxc_org_a';
    await getDb()
      .insert(parties)
      .values({
        id: 'dece0000-0000-0000-0000-0000000000e1',
        dealId: DEAL_PURCHASE,
        role: 'seller',
        fullName: 'Seed Seller',
      })
      .onConflictDoNothing();
    const ex = await getDealExceptions(DEAL_PURCHASE);
    expect(ex.map((e) => e.kind)).not.toContain('purchase_missing_seller');
  });

  it('returns no exceptions for a clean deal', async () => {
    currentClerkOrgId = 'dxc_org_a';
    expect(await getDealExceptions(DEAL_CLEAN)).toEqual([]);
  });

  it('is RLS-isolated — another org sees nothing for this deal', async () => {
    currentClerkOrgId = 'dxc_org_b';
    expect(await getDealExceptions(DEAL_PURCHASE)).toEqual([]);
  });
});
