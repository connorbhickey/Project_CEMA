/**
 * Intake Agent — durable-wrap integration proof (Phase 1 Month 11, PR-B / ADR 0013).
 *
 * The in-process sibling (tests/integration/intake-agent-rls.test.ts) proves the
 * RLS write path via the orchestration-agnostic core `runIntake`. THIS suite proves
 * the durable wrap is behaviour-equivalent: the same eligibility → audit → deal
 * outcomes, but driven through the real Workflow runtime — `start()` enqueues the
 * `'use workflow'` orchestrator into an in-process Local World (provided by the
 * @workflow/vitest plugin), which executes the three SWC-compiled `'use step'`
 * boundaries and persists each step's result. No backend / OIDC token required for
 * orchestration state; the steps themselves still hit the real Neon branch through
 * buildIntakeDeps, so the suite is Neon-gated (describe.skipIf), like its siblings.
 *
 * Scope deliberately narrow: it does NOT re-prove cross-org RLS isolation (the
 * in-process suite owns that) — only that wrapping runIntake as durable steps did
 * not change the externally observable result or the persisted rows.
 *
 * Runs under vitest.integration.config.ts (pnpm test:workflow), never the default
 * `pnpm test` — the required-CI "Unit tests" job excludes tests/workflow/**.
 *
 * DEFERRED — gated off by default (ADR 0013 carry-over #5). VERIFIED 2026-06-07
 * by an actual RUN_WDK_INTEGRATION=1 run; the root cause is sharper than the
 * original note (which blamed @cema/agents-intake's extensionless re-exports):
 *
 *   [local world] Cannot find module '…/lib/agents/chain-of-title/deps.js'
 *   imported from '…/apps/web/.workflow-vitest/steps.mjs'  (ERR_MODULE_NOT_FOUND)
 *
 * @workflow/vitest hardcodes `externalizeNonSteps: true` (no override in its
 * WorkflowTestOptions), so its rollup builder bundles EVERY apps/web `'use step'`
 * module into ONE shared `.workflow-vitest/steps.mjs` and EXTERNALIZES each step's
 * non-step imports — rewriting them to `.js`. But those imports are raw `.ts`
 * source (e.g. `lib/agents/<agent>/deps.ts`, and transitively the @cema/* packages),
 * with no built `.js` sibling, so Node's ESM loader can't resolve `./deps.js`. The
 * FIRST failure is apps/web's own local deps (all four agents' steps share the
 * bundle); the @cema/* re-exports would be the next. Production is unaffected:
 * `withWorkflow` compiles steps via Turbopack, which honors `transpilePackages`.
 *
 * No proportionate fix exists today: bundling the whole step-import closure to
 * `.js` (or shipping dist/ for every step-dep + @cema/* package) is a broad
 * build-system change; a TS ESM loader (tsx) or patching the plugin to expose
 * `externalizeNonSteps: false` are new deps / forks. The clean path is upstream:
 * a @workflow/vitest option to bundle (not externalize) workspace TS-source.
 *
 * Meanwhile the orchestration unit test (intake.workflow.test.ts, mocked steps) is
 * the authoritative behavioral guard; this suite stands as the executable spec for
 * the real start() → run.returnValue proof. Opt in with RUN_WDK_INTEGRATION=1
 * (plus DATABASE_URL) to reproduce the blocker. See the skip gate below.
 */

import { deals, getDb, organizations, users } from '@cema/db';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start } from 'workflow/api';

import { intakeWorkflow } from '../../lib/agents/intake/intake.workflow';

// Fresh per-run ids keep the suite hermetic: deal assertions filter by this run's
// org, and the org + user rows are left behind by afterAll (append-only audit rows
// reference them under ON DELETE RESTRICT), so unique ids prevent any collision.
const ORG_ID = crypto.randomUUID();
const USER_ID = crypto.randomUUID();

// Two gates, both required to run:
//   1. DATABASE_URL — the steps do real Neon writes through buildIntakeDeps.
//   2. RUN_WDK_INTEGRATION — opt-in, OFF by default. The @workflow/vitest builder
//      externalizes every step's non-step imports (rewritten to `.js`), but the
//      apps/web step-deps (lib/agents/<agent>/deps.ts) + the @cema/* packages are
//      raw TS source with no built `.js` sibling, so Node's ESM loader rejects the
//      shared steps.mjs (ERR_MODULE_NOT_FOUND, first on chain-of-title/deps.js).
//      Production is unaffected: `withWorkflow` compiles steps via Turbopack, which
//      honors transpilePackages. Stays off so `pnpm test:workflow` is green. See
//      the header comment for the verified root cause + ADR 0013 carry-over #5.
const skip = !process.env.DATABASE_URL || !process.env.RUN_WDK_INTEGRATION;

function getNeonSql(): NeonQueryFunction<false, false> {
  return neon(process.env.DATABASE_URL!);
}

describe.skipIf(skip)('Intake Agent — durable workflow (WDK runtime)', () => {
  beforeAll(async () => {
    const db = getDb();
    // Handles derive from the per-run ids so re-runs never collide on the unique
    // clerkOrgId/clerkUserId/slug indexes (the rows survive afterAll).
    await db
      .insert(organizations)
      .values({
        id: ORG_ID,
        clerkOrgId: `org_intake_wdk_${ORG_ID}`,
        name: 'Org (Intake WDK)',
        slug: `intake-wdk-${ORG_ID}`,
      })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: `user_intake_wdk_${USER_ID}`,
        email: `intake-wdk-${USER_ID}@example.invalid`,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const nsql = getNeonSql();
    // Reclaim only the trigger-free `deals` rows (cascades existing_loans). The
    // audit_events rows can't be deleted (§10.5 immutability trigger) and they pin
    // the org + user under ON DELETE RESTRICT — all three are left behind by design;
    // the per-run-unique ids keep that accumulation from colliding with assertions.
    await nsql`DELETE FROM deals WHERE organization_id = ${ORG_ID}`;
  });

  it('eligible application: durable run creates the same Deal + savings as the core', async () => {
    const run = await start(intakeWorkflow, ['FIX-ELIG-SF', ORG_ID, USER_ID]);
    expect(run.runId).toMatch(/^wrun_/);

    // Blocks until the durable run completes (or throws if it fails).
    const result = await run.returnValue;
    expect(await run.status).toBe('completed');

    expect(result.eligibility.eligible).toBe(true);
    expect(result.dealId).toBeTruthy();
    // Savings are computed inside createDealStep on PLACEHOLDER_RATES; FIX-ELIG-SF
    // has a 400k existing UPB — the same number the in-process core produces.
    expect(result.savings).not.toBeNull();
    expect(result.savings!.assignedUpb).toBe(400_000);

    // The deal the step actually persisted, under the org we passed in.
    const db = getDb();
    const [deal] = await db.select().from(deals).where(eq(deals.id, result.dealId!));
    expect(deal).toBeTruthy();
    expect(deal!.organizationId).toBe(ORG_ID);
    expect(deal!.createdById).toBe(USER_ID);
    expect(deal!.cemaType).toBe('refi_cema');
    expect(deal!.metadata.externalId).toBe('FIX-ELIG-SF');
  });

  it('ineligible application: durable run records the decision but creates no Deal', async () => {
    const run = await start(intakeWorkflow, ['FIX-INELIG-COOP', ORG_ID, USER_ID]);
    const result = await run.returnValue;
    expect(await run.status).toBe('completed');

    expect(result.eligibility.eligible).toBe(false);
    expect(result.dealId).toBeNull();
    expect(result.savings).toBeNull();

    // No Deal carrying this externalId was persisted under our org.
    const db = getDb();
    const orgDeals = await db.select().from(deals).where(eq(deals.organizationId, ORG_ID));
    expect(orgDeals.find((d) => d.metadata.externalId === 'FIX-INELIG-COOP')).toBeUndefined();
  });
});
