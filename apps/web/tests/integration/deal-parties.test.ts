import { auditEvents, deals, getDb, organizations, parties, users } from '@cema/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'dpe_org_a';
const currentClerkUser = { id: 'dpe_user_a' };

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
  getCurrentUser: () => Promise.resolve(currentClerkUser),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { addDealParty, removeDealParty, updateDealParty } =
  await import('../../lib/actions/manage-deal-parties');
const { getDealParties } = await import('../../lib/queries/deal-parties');

// Distinctive `9a47e510-…` ("deal-parties") namespace + `dpe_` clerk fields so no
// unique field collides with another suite on the shared Neon dev branch.
const ORG_A = '9a47e510-0000-0000-0000-000000000001';
const ORG_B = '9a47e510-0000-0000-0000-000000000002';
const USER_A = '9a47e510-0000-0000-0000-000000000003';
const DEAL_A = '9a47e510-0000-0000-0000-00000000000a';
const DEAL_B = '9a47e510-0000-0000-0000-00000000000b';

describe.skipIf(skip)('deal-parties editor (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'dpe_org_a', name: 'DPE A', slug: 'dpe-a' },
        { id: ORG_B, clerkOrgId: 'dpe_org_b', name: 'DPE B', slug: 'dpe-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'dpe_user_a', email: 'dpe-a@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values([
        {
          id: DEAL_A,
          organizationId: ORG_A,
          cemaType: 'purchase_cema',
          status: 'title_work',
          createdById: USER_A,
        },
        {
          id: DEAL_B,
          organizationId: ORG_B,
          cemaType: 'purchase_cema',
          status: 'title_work',
          createdById: USER_A,
        },
      ])
      .onConflictDoNothing();
    // Clean slate for deterministic add/remove across reruns (parties are deletable).
    await db.delete(parties).where(eq(parties.dealId, DEAL_A));
  });

  afterAll(async () => {
    const db = getDb();
    // Only per-run child rows; orgs/users/deals stay (audit_events is immutable).
    await db.delete(parties).where(eq(parties.dealId, DEAL_A));
  });

  it('adds a seller party and writes a PII-safe party.added audit', async () => {
    currentClerkOrgId = 'dpe_org_a';
    await addDealParty({
      dealId: DEAL_A,
      role: 'seller',
      fullName: 'Sally Seller DPE',
      email: 'sally.dpe@example.invalid',
    });

    const rows = await getDealParties(DEAL_A);
    const seller = rows.find((p) => p.role === 'seller');
    expect(seller?.fullName).toBe('Sally Seller DPE');
    expect(seller?.email).toBe('sally.dpe@example.invalid');

    // The audit carries role + partyId only — NEVER the name/email (hard rule #3).
    const audits = await getDb()
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'party.added'), eq(auditEvents.entityId, DEAL_A)));
    expect(audits.length).toBeGreaterThan(0);
    const meta = JSON.stringify(audits.map((a) => a.metadata));
    expect(meta).toContain('seller');
    expect(meta).not.toContain('Sally');
    expect(meta).not.toContain('sally.dpe');
  });

  it('updates a party in place and writes a PII-safe party.updated audit', async () => {
    currentClerkOrgId = 'dpe_org_a';
    const before = await getDealParties(DEAL_A);
    const target = before.find((p) => p.role === 'seller');
    expect(target).toBeDefined();

    await updateDealParty({
      dealId: DEAL_A,
      partyId: target!.id,
      role: 'seller',
      fullName: 'Sandra Seller DPE',
      email: 'sandra.dpe@example.invalid',
    });

    const after = await getDealParties(DEAL_A);
    const updated = after.find((p) => p.id === target!.id);
    expect(updated?.fullName).toBe('Sandra Seller DPE');
    expect(updated?.email).toBe('sandra.dpe@example.invalid');

    const updateAudits = await getDb()
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'party.updated'), eq(auditEvents.entityId, DEAL_A)));
    expect(updateAudits.length).toBeGreaterThan(0);
    expect(JSON.stringify(updateAudits.map((a) => a.metadata))).not.toContain('Sandra');
  });

  it('rejects an invalid role at the boundary', async () => {
    currentClerkOrgId = 'dpe_org_a';
    await expect(
      addDealParty({ dealId: DEAL_A, role: 'not_a_role', fullName: 'X' }),
    ).rejects.toThrow(/role/i);
  });

  it('removes a party and writes a party.removed audit', async () => {
    currentClerkOrgId = 'dpe_org_a';
    const before = await getDealParties(DEAL_A);
    const target = before.find((p) => p.role === 'seller');
    expect(target).toBeDefined();

    await removeDealParty({ dealId: DEAL_A, partyId: target!.id });

    const after = await getDealParties(DEAL_A);
    expect(after.some((p) => p.id === target!.id)).toBe(false);

    const removeAudits = await getDb()
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'party.removed'), eq(auditEvents.entityId, DEAL_A)));
    expect(removeAudits.length).toBeGreaterThan(0);
  });

  it('is RLS-isolated — another org cannot add to or read this deal', async () => {
    currentClerkOrgId = 'dpe_org_b';
    await expect(
      addDealParty({ dealId: DEAL_A, role: 'seller', fullName: 'Intruder' }),
    ).rejects.toThrow(/deal not found/i);
    expect(await getDealParties(DEAL_A)).toEqual([]);
  });
});
