import { auditEvents, deals, existingLoans, getDb, organizations, users } from '@cema/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'dle_org_a';
const currentClerkUser = { id: 'dle_user_a' };

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
  getCurrentUser: () => Promise.resolve(currentClerkUser),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { addExistingLoan, removeExistingLoan, updateExistingLoan } =
  await import('../../lib/actions/manage-deal-loans');

// Distinctive `10a47e51-…` ("deal-loans-editor") namespace + `dle_` clerk fields.
const ORG_A = '10a47e51-0000-0000-0000-000000000001';
const ORG_B = '10a47e51-0000-0000-0000-000000000002';
const USER_A = '10a47e51-0000-0000-0000-000000000003';
const DEAL_A = '10a47e51-0000-0000-0000-00000000000a';
const DEAL_B = '10a47e51-0000-0000-0000-00000000000b';

const loansFor = (dealId: string) =>
  getDb().select().from(existingLoans).where(eq(existingLoans.dealId, dealId));

describe.skipIf(skip)('deal-loans editor (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'dle_org_a', name: 'DLE A', slug: 'dle-a' },
        { id: ORG_B, clerkOrgId: 'dle_org_b', name: 'DLE B', slug: 'dle-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'dle_user_a', email: 'dle-a@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values([
        {
          id: DEAL_A,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'title_work',
          createdById: USER_A,
        },
        {
          id: DEAL_B,
          organizationId: ORG_B,
          cemaType: 'refi_cema',
          status: 'title_work',
          createdById: USER_A,
        },
      ])
      .onConflictDoNothing();
    await db.delete(existingLoans).where(eq(existingLoans.dealId, DEAL_A));
  });

  afterAll(async () => {
    await getDb().delete(existingLoans).where(eq(existingLoans.dealId, DEAL_A));
  });

  it('adds a loan and writes a PII-safe loan.added audit (no UPB figure)', async () => {
    currentClerkOrgId = 'dle_org_a';
    await addExistingLoan(DEAL_A, {
      upb: '456789',
      chainPosition: '0',
      recordedCrfn: '2020000111222',
    });

    const rows = await loansFor(DEAL_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.upb).toBe('456789.00');
    expect(rows[0]!.chainPosition).toBe(0);

    const audits = await getDb()
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'loan.added'), eq(auditEvents.entityId, DEAL_A)));
    expect(audits.length).toBeGreaterThan(0);
    // The audit carries chainPosition but never the UPB/payoff figure (hard rule #3).
    const meta = JSON.stringify(audits.map((a) => a.metadata));
    expect(meta).not.toContain('456789');
  });

  it('updates a loan in place and writes a PII-safe loan.updated audit', async () => {
    currentClerkOrgId = 'dle_org_a';
    const [loan] = await loansFor(DEAL_A);
    expect(loan).toBeDefined();

    await updateExistingLoan(DEAL_A, loan!.id, {
      upb: '333333',
      chainPosition: '0',
      investor: 'Freddie Mac',
    });

    const [after] = await loansFor(DEAL_A);
    expect(after!.upb).toBe('333333.00');
    expect(after!.investor).toBe('Freddie Mac');

    const updateAudits = await getDb()
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'loan.updated'), eq(auditEvents.entityId, DEAL_A)));
    expect(updateAudits.length).toBeGreaterThan(0);
    expect(JSON.stringify(updateAudits.map((a) => a.metadata))).not.toContain('333333');
  });

  it('rejects a duplicate chain position within the deal', async () => {
    currentClerkOrgId = 'dle_org_a';
    await expect(addExistingLoan(DEAL_A, { upb: '1', chainPosition: '0' })).rejects.toThrow(
      /chain position 0 is already used/i,
    );
  });

  it('rejects both reel/page and crfn (the recording XOR invariant)', async () => {
    currentClerkOrgId = 'dle_org_a';
    await expect(
      addExistingLoan(DEAL_A, {
        upb: '1',
        chainPosition: '9',
        recordedReelPage: 'R1/P1',
        recordedCrfn: '2020000000001',
      }),
    ).rejects.toThrow(/reel\/page .* or a CRFN/i);
  });

  it('removes a loan and writes a loan.removed audit', async () => {
    currentClerkOrgId = 'dle_org_a';
    const [loan] = await loansFor(DEAL_A);
    expect(loan).toBeDefined();
    await removeExistingLoan({ dealId: DEAL_A, loanId: loan!.id });
    expect(await loansFor(DEAL_A)).toHaveLength(0);

    const removeAudits = await getDb()
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'loan.removed'), eq(auditEvents.entityId, DEAL_A)));
    expect(removeAudits.length).toBeGreaterThan(0);
  });

  it('is RLS-isolated — another org cannot add to this deal', async () => {
    currentClerkOrgId = 'dle_org_b';
    await expect(addExistingLoan(DEAL_A, { upb: '1', chainPosition: '0' })).rejects.toThrow(
      /deal not found/i,
    );
  });
});
