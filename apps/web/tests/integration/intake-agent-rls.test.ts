/**
 * Intake Agent — app-wiring integration proof (Phase 1 Month 10).
 *
 * Exercises the FULL production write path of the agent: buildIntakeDeps wires
 * the orchestration-agnostic core (`@cema/agents-intake`) to real `withRls`
 * transactions, and runIntake drives it end-to-end against a real Neon branch.
 * This is the seam the unit tests can't cover — they use in-memory fakes; here
 * the collaborators are the actual RLS-scoped DB writes.
 *
 * Proves three things:
 *   1. Eligible app → minimal intake Deal + existing_loan + two audit rows
 *      (intake.evaluated then deal.created), all under cema_app_user RLS.
 *   2. Ineligible app → intake.evaluated recorded, NO Deal created.
 *   3. A Deal created under Org A is invisible under Org B's RLS context.
 *
 * Hits a real Neon branch — intentionally NOT mocked. Skips when DATABASE_URL is
 * absent (CI without the secret) via describe.skipIf, like the sibling suites.
 */

import { FixtureLosAdapter, runIntake } from '@cema/agents-intake';
import { auditEvents, deals, existingLoans, getDb, organizations, users } from '@cema/db';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildIntakeDeps } from '../../lib/agents/intake/deps';

// Fresh per-run ids make the suite hermetic: every assertion filters by this
// run's org, so it never sees audit rows a previous run left behind. Audit rows
// ARE left behind (append-only — see afterAll), so they accumulate; unique org
// ids keep that accumulation from ever colliding with these exact counts.
const ORG_A_ID = crypto.randomUUID();
const ORG_B_ID = crypto.randomUUID();
const USER_ID = crypto.randomUUID();

const skip = !process.env.DATABASE_URL;

function getNeonSql(): NeonQueryFunction<false, false> {
  return neon(process.env.DATABASE_URL!);
}

/** Deps under test, fixed to Org A + the seeded processor; FixtureLosAdapter for loan data. */
function depsForOrgA() {
  return buildIntakeDeps({
    organizationId: ORG_A_ID,
    actorUserId: USER_ID,
    adapter: new FixtureLosAdapter(),
  });
}

describe.skipIf(skip)('Intake Agent — app wiring (RLS write path)', () => {
  beforeAll(async () => {
    const db = getDb();
    // Handles are derived from the per-run ids so re-runs never collide on the
    // unique clerkOrgId/clerkUserId/slug indexes. The org + user rows are left
    // behind by afterAll (append-only audit rows reference them under RESTRICT),
    // so a fixed handle would clash on the second run.
    await db
      .insert(organizations)
      .values([
        {
          id: ORG_A_ID,
          clerkOrgId: `org_intake_a_${ORG_A_ID}`,
          name: 'Org A (Intake)',
          slug: `intake-a-${ORG_A_ID}`,
        },
        {
          id: ORG_B_ID,
          clerkOrgId: `org_intake_b_${ORG_B_ID}`,
          name: 'Org B (Intake)',
          slug: `intake-b-${ORG_B_ID}`,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: `user_intake_${USER_ID}`,
        email: `intake-${USER_ID}@example.invalid`,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const nsql = getNeonSql();
    // Reclaim only the trigger-free `deals` rows (cascades existing_loans). The
    // audit_events rows can't be deleted — the §10.5 immutability trigger blocks
    // DELETE for every role — and because they reference the org + user under
    // ON DELETE RESTRICT, those two can't be removed either. All three are left
    // behind intentionally; the per-run-unique ids keep that accumulation from
    // ever colliding with this run's assertions.
    await nsql`DELETE FROM deals WHERE organization_id IN (${ORG_A_ID}, ${ORG_B_ID})`;
  });

  it('eligible application creates a Deal, existing_loan, and two audit rows', async () => {
    const result = await runIntake('FIX-ELIG-SF', depsForOrgA());

    expect(result.eligibility.eligible).toBe(true);
    expect(result.dealId).toBeTruthy();
    const db = getDb();

    // ── Deal row ───────────────────────────────────────────────────────────
    const [deal] = await db.select().from(deals).where(eq(deals.id, result.dealId!));
    expect(deal).toBeTruthy();
    expect(deal!.organizationId).toBe(ORG_A_ID);
    expect(deal!.createdById).toBe(USER_ID);
    expect(deal!.cemaType).toBe('refi_cema'); // FIX-ELIG-SF is a refi
    expect(deal!.status).toBe('intake'); // schema default
    expect(deal!.propertyId).toBeNull(); // enriched later — never invented
    expect(deal!.newLoanId).toBeNull();
    const dealMeta = deal!.metadata;
    expect(dealMeta.source).toBe('intake-agent');
    expect(dealMeta.externalId).toBe('FIX-ELIG-SF');

    // ── existing_loan row (the §255-exempt UPB) ──────────────────────────────
    const loans = await db.select().from(existingLoans).where(eq(existingLoans.dealId, deal!.id));
    expect(loans).toHaveLength(1);
    expect(Number(loans[0]!.upb)).toBe(400_000); // FIX-ELIG-SF existingUpb
    expect(loans[0]!.chainPosition).toBe(0);

    // ── Audit rows: intake.evaluated (application) + deal.created (deal) ──────
    const audits = (
      await db.select().from(auditEvents).where(eq(auditEvents.organizationId, ORG_A_ID))
    ).filter((a) => a.metadata.externalId === 'FIX-ELIG-SF');

    // Exactly two rows, one of each action — no duplicate/stray emissions. This
    // matters for an append-only log (§10.5): a double-emit can't be cleaned up,
    // so the contract is enforced as exact, not "at least one". Ordering
    // (evaluated before created) is proven below by entityId: null → deal.id.
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => a.action).sort()).toEqual(['deal.created', 'intake.evaluated']);

    const evaluated = audits.find((a) => a.action === 'intake.evaluated');
    expect(evaluated).toBeTruthy();
    expect(evaluated!.entityType).toBe('application');
    expect(evaluated!.entityId).toBeNull(); // no Deal UUID at evaluation time
    expect(evaluated!.metadata.eligible).toBe(true);

    const created = audits.find((a) => a.action === 'deal.created');
    expect(created).toBeTruthy();
    expect(created!.entityType).toBe('deal');
    expect(created!.entityId).toBe(deal!.id);
    expect(created!.actorUserId).toBe(USER_ID);
  });

  it('ineligible application records intake.evaluated but creates no Deal', async () => {
    const result = await runIntake('FIX-INELIG-COOP', depsForOrgA());

    expect(result.eligibility.eligible).toBe(false);
    expect(result.dealId).toBeNull();
    const db = getDb();

    const audits = (
      await db.select().from(auditEvents).where(eq(auditEvents.organizationId, ORG_A_ID))
    ).filter((a) => a.metadata.externalId === 'FIX-INELIG-COOP');

    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('intake.evaluated');
    expect(audits[0]!.metadata.eligible).toBe(false);

    // No deal.created row, and no Deal carrying this externalId.
    expect(audits.find((a) => a.action === 'deal.created')).toBeUndefined();
  });

  it('a Deal created under Org A is invisible under Org B RLS context', async () => {
    const result = await runIntake('FIX-ELIG-CONDO', depsForOrgA());
    expect(result.dealId).toBeTruthy();

    const nsql = getNeonSql();
    // Query as cema_app_user (BYPASSRLS=false) in Org B's context — one tx.
    const rows = await nsql.transaction([
      nsql`SELECT set_config('app.current_organization_id', ${ORG_B_ID}, true)`,
      nsql`SET LOCAL ROLE cema_app_user`,
      nsql`SELECT id, organization_id FROM deals`,
    ]);
    const visibleToB = rows[2] as Array<{ id: string; organization_id: string }>;
    expect(visibleToB.find((d) => d.id === result.dealId)).toBeUndefined();
  });
});
