/**
 * RLS multi-tenant isolation — Phase 0 Month 1 compliance proof.
 *
 * Two orgs in the same Neon DB. A Deal created under Org A must NOT be
 * readable when the RLS context is set to Org B. This hits a real Neon
 * branch — it is intentionally NOT mocked.
 *
 * ─── Why this test still exists after Phase 0 Month 2 RLS fix ─────────────
 * The companion `withrls-enforcement.test.ts` exercises the *production*
 * code path (`withRls()` from `apps/web/lib/with-rls.ts`). This test
 * exercises the *underlying RLS policies* directly via a batched
 * neon.transaction([…]) — a lower-level proof that the policies themselves
 * filter rows when the session is a non-BYPASSRLS role. Both tests are
 * valuable: this one isolates the policy layer, the other isolates the
 * application wrapper.
 *
 * ─── Why SET LOCAL ROLE? ───────────────────────────────────────────────────
 * The Neon connection string uses `neondb_owner`, which has BYPASSRLS=true.
 * To exercise the RLS policy the SELECT must run as a role with BYPASSRLS=false.
 * `cema_app_user` (provisioned by migration 0002_app_role.sql) is that role;
 * `SET LOCAL ROLE cema_app_user` downgrades the session for the duration of
 * the batched transaction.
 *
 * ─── Why neon.transaction() instead of the production withRls path? ───────
 * This test deliberately uses the raw neon HTTP batched-transaction form
 * to isolate the *policy* from the *wrapper*. The withRls wrapper is now
 * exercised by withrls-enforcement.test.ts. Splitting the proofs makes a
 * regression in either layer obvious.
 *
 * ─── Why sql([rawString]) for the DO block? ───────────────────────────────
 * Not used anymore — role provisioning moved to migration 0002_app_role.sql.
 */

import { deals, getDb, organizations, users } from '@cema/db';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORG_A_ID = '00000000-0000-0000-0000-00000000000a';
const ORG_B_ID = '00000000-0000-0000-0000-00000000000b';
const USER_ID = '00000000-0000-0000-0000-000000000099';

// Skip the entire suite when DATABASE_URL is absent (e.g. CI without the secret).
const skip = !process.env.DATABASE_URL;

/** Raw neon client used for SET LOCAL ROLE batched transactions. */
function getNeonSql(): NeonQueryFunction<false, false> {
  return neon(process.env.DATABASE_URL!);
}

describe.skipIf(skip)('RLS multi-tenant isolation', () => {
  beforeAll(async () => {
    // Role provisioning (CREATE ROLE cema_app_user, GRANTs, GRANT membership
    // to neondb_owner) is now handled by migration 0002_app_role.sql. The
    // migration runs automatically against every Neon branch (dev, preview,
    // production) so the role is guaranteed to exist before the test runs.
    // Seed org and user rows only.
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        {
          id: ORG_A_ID,
          clerkOrgId: 'org_rls_test_a',
          name: 'Org A (RLS Test)',
          slug: 'rls-test-org-a',
        },
        {
          id: ORG_B_ID,
          clerkOrgId: 'org_rls_test_b',
          name: 'Org B (RLS Test)',
          slug: 'rls-test-org-b',
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_rls_isolation_test',
        email: 'rls-isolation-test@example.invalid',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const nsql = getNeonSql();

    // neondb_owner has BYPASSRLS=true so no RLS context is needed for cleanup.
    // ORG_A_ID, ORG_B_ID, USER_ID are compile-time constants — not user input.
    await nsql`DELETE FROM deals         WHERE organization_id IN (${ORG_A_ID}, ${ORG_B_ID})`;
    await nsql`DELETE FROM organizations WHERE id             IN (${ORG_A_ID}, ${ORG_B_ID})`;
    await nsql`DELETE FROM users         WHERE id              = ${USER_ID}`;
  });

  it('Org B cannot see a Deal that was created under Org A', async () => {
    const db = getDb();
    const nsql = getNeonSql();

    // ── Step 1: Insert a Deal for Org A ────────────────────────────────────
    // neondb_owner bypasses RLS — the INSERT does not require a context.
    const [aDeal] = await db
      .insert(deals)
      .values({
        organizationId: ORG_A_ID,
        cemaType: 'refi_cema',
        createdById: USER_ID,
      })
      .returning();

    expect(aDeal).toBeTruthy();
    expect(aDeal!.organizationId).toBe(ORG_A_ID);

    // ── Step 2: Query as cema_app_user (BYPASSRLS=false) in Org B's context ─
    // All three statements execute in ONE Postgres transaction (one HTTP call).
    // SET LOCAL ROLE and set_config(..., true) both reset at transaction end.
    const rows = await nsql.transaction([
      nsql`SELECT set_config('app.current_organization_id', ${ORG_B_ID}, true)`,
      nsql`SET LOCAL ROLE cema_app_user`,
      nsql`SELECT id, organization_id FROM deals`,
    ]);

    // rows[2] is the deals SELECT result — rows visible under Org B's context.
    const dealsVisibleToOrgB = rows[2] as Array<{ id: string; organization_id: string }>;
    const leaked = dealsVisibleToOrgB.find((d) => d.id === aDeal!.id);

    expect(leaked).toBeUndefined();
  });

  it('Org A can see its own Deal when the RLS context is Org A', async () => {
    const nsql = getNeonSql();

    // Same pattern — Org A's context this time. Org A's deal must appear.
    const rows = await nsql.transaction([
      nsql`SELECT set_config('app.current_organization_id', ${ORG_A_ID}, true)`,
      nsql`SET LOCAL ROLE cema_app_user`,
      nsql`SELECT id, organization_id FROM deals`,
    ]);

    const dealsVisibleToOrgA = rows[2] as Array<{ id: string; organization_id: string }>;
    const ownDeal = dealsVisibleToOrgA.find((d) => d.organization_id === ORG_A_ID);

    expect(ownDeal).toBeTruthy();
  });
});
