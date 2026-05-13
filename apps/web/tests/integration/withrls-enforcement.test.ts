/**
 * RLS enforcement through the PRODUCTION code path — Phase 0 Month 2 carry-over.
 *
 * The companion test `rls-isolation.test.ts` proves the RLS *policies* themselves
 * work when run as `cema_app_user` (BYPASSRLS=false) inside a single neon.transaction
 * batch. But it sidesteps the production code path entirely: production calls
 * `withRls(orgId, fn)` from `apps/web/lib/with-rls.ts`, which previously had two bugs:
 *
 *   Bug A — `neondb_owner` has BYPASSRLS=true. RLS policies never applied.
 *   Bug B — `drizzle-orm/neon-http` makes every `db.execute()` its own Postgres
 *           transaction, so `set_config(..., true)` from withRls evaporated before
 *           the callback's tx.insert()/tx.select() ran.
 *
 * This test exercises THE production path: `getDb()` + `withRls()` + Drizzle
 * `tx.query.deals.findMany()`. It seeds a Deal under Org A directly (bypassing
 * withRls), then calls listDeals-style code under Org B's context, and asserts
 * Org A's Deal is invisible. If either bug regresses, this test must fail.
 *
 * The role provisioning (`cema_app_user`, GRANTs, GRANT membership to neondb_owner)
 * is handled by migration `0002_app_role.sql` — this test assumes the migration
 * has run on the target Neon branch.
 */

import { deals, getDb, organizations, users } from '@cema/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const ORG_A_ID = '00000000-0000-0000-0000-0000000000a1';
const ORG_B_ID = '00000000-0000-0000-0000-0000000000b1';
const USER_ID = '00000000-0000-0000-0000-000000000091';

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('withRls — production code path enforces RLS', () => {
  beforeAll(async () => {
    // Seed two orgs + one user as neondb_owner (bypasses RLS — fine for setup).
    // The cema_app_user role is provisioned by migration 0002_app_role.sql.
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        {
          id: ORG_A_ID,
          clerkOrgId: 'org_withrls_test_a',
          name: 'Org A (withRls enforcement test)',
          slug: 'withrls-test-org-a',
        },
        {
          id: ORG_B_ID,
          clerkOrgId: 'org_withrls_test_b',
          name: 'Org B (withRls enforcement test)',
          slug: 'withrls-test-org-b',
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_withrls_enforcement_test',
        email: 'withrls-enforcement-test@example.invalid',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // Cleanup as neondb_owner — BYPASSRLS=true lets us delete across orgs.
    const db = getDb();
    await db.execute(sql`DELETE FROM deals WHERE organization_id IN (${ORG_A_ID}, ${ORG_B_ID})`);
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${ORG_A_ID}, ${ORG_B_ID})`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
  });

  it('Org B cannot see Org A deals when reading through withRls(orgB, ...)', async () => {
    const db = getDb();

    // Step 1: insert an Org A deal directly as neondb_owner (RLS bypassed for setup).
    const [aDeal] = await db
      .insert(deals)
      .values({
        organizationId: ORG_A_ID,
        cemaType: 'refi_cema',
        createdById: USER_ID,
      })
      .returning();
    expect(aDeal).toBeTruthy();

    // Step 2: read all deals under Org B's RLS context — the PRODUCTION path.
    // This is what listDeals() / getDeal() / createDeal() actually call.
    const visibleToOrgB = await withRls(ORG_B_ID, async (tx) =>
      tx.query.deals.findMany({ columns: { id: true, organizationId: true } }),
    );

    // If RLS is enforced through the production code path, Org B sees nothing
    // belonging to Org A. If either Bug A or Bug B regresses, this assertion fails.
    const leaked = visibleToOrgB.find((d) => d.id === aDeal!.id);
    expect(leaked).toBeUndefined();
    expect(visibleToOrgB.every((d) => d.organizationId !== ORG_A_ID)).toBe(true);
  });

  it('Org A sees its own deals when reading through withRls(orgA, ...)', async () => {
    // Sanity-check the positive case. If the production path *over-restricts*
    // (e.g., never gets to fn() because of a guard misfire), this fails first.
    const visibleToOrgA = await withRls(ORG_A_ID, async (tx) =>
      tx.query.deals.findMany({ columns: { id: true, organizationId: true } }),
    );
    expect(visibleToOrgA.some((d) => d.organizationId === ORG_A_ID)).toBe(true);
  });

  it('rejects non-UUID organization IDs before opening a transaction', async () => {
    // Cheap defense-in-depth: bad UUID must throw, not silently set garbage.
    // The callback never runs because UUID validation fires before
    // db.transaction(), so it doesn't need to be async.
    await expect(withRls('not-a-uuid', () => Promise.resolve(1))).rejects.toThrow(/UUID/);
  });

  it('runtime guard surfaces if the session somehow remains BYPASSRLS', async () => {
    // Simulate a regression where a developer accidentally undoes the
    // SET LOCAL ROLE: open the same kind of transaction by hand, skip the
    // role downgrade, and call the same guard query that withRls runs.
    // CURRENT_USER stays as neondb_owner (BYPASSRLS=true), so the row
    // exists and rolbypassrls = true — proving the guard would detect
    // this regression at runtime.
    const db = getDb();
    const observed = await db.transaction(async (tx) => {
      const result = await tx.execute(
        sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = CURRENT_USER`,
      );
      // neon-serverless: { rows: [{ rolbypassrls: boolean }] }
      return (result as unknown as { rows: Array<{ rolbypassrls: boolean }> }).rows[0]
        ?.rolbypassrls;
    });
    // If this ever flips to false we either changed the connection user
    // (great!) or the migration's GRANT membership broke (investigate).
    expect(observed).toBe(true);
  });
});
