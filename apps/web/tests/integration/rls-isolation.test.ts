/**
 * RLS multi-tenant isolation — Phase 0 Month 1 compliance proof.
 *
 * Two orgs in the same Neon DB. A Deal created under Org A must NOT be
 * readable when the RLS context is set to Org B. This hits a real Neon
 * branch — it is intentionally NOT mocked.
 *
 * ─── Why SET LOCAL ROLE? ───────────────────────────────────────────────────
 * The Neon connection string uses `neondb_owner`, which has BYPASSRLS=true.
 * To exercise the RLS policy the SELECT must run as a role with BYPASSRLS=false.
 * We create `cema_app_user` in beforeAll and use `SET LOCAL ROLE cema_app_user`
 * inside a neon transaction batch.
 *
 * ─── Why neon.transaction() instead of db.execute()? ──────────────────────
 * drizzle-orm/neon-http throws "No transactions support" for db.transaction().
 * Each db.execute() is a separate HTTP round-trip (its own Postgres txn), so
 * `SET LOCAL` settings reset between calls. neon().transaction([...]) sends
 * all statements in one HTTP request inside one real Postgres transaction —
 * the only way to keep LOCAL settings in scope for the SELECT.
 *
 * ─── Why sql([rawString]) for the DO block? ───────────────────────────────
 * Postgres DO blocks cannot accept query parameters ($1, $2, …). Using
 * `nsql\`DO $$ … ${param} … $$\`` would trigger "bind message supplies N
 * parameters, but prepared statement requires 0". Calling nsql([rawString])
 * sends the statement with zero parameters so the DO block executes cleanly.
 * The string is a compile-time constant — not user input — so no injection risk.
 */

import { deals, getDb, organizations, users } from '@cema/db';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORG_A_ID = '00000000-0000-0000-0000-00000000000a';
const ORG_B_ID = '00000000-0000-0000-0000-00000000000b';
const USER_ID = '00000000-0000-0000-0000-000000000099';

// The app role must have BYPASSRLS=false (Postgres default for new roles).
// This is a compile-time constant, never derived from user input.
const APP_ROLE = 'cema_app_user';

// Skip the entire suite when DATABASE_URL is absent (e.g. CI without the secret).
const skip = !process.env.DATABASE_URL;

/** Raw neon client used for SET LOCAL ROLE batched transactions. */
function getNeonSql(): NeonQueryFunction<false, false> {
  return neon(process.env.DATABASE_URL!);
}

describe.skipIf(skip)('RLS multi-tenant isolation', () => {
  beforeAll(async () => {
    const db = getDb();
    const nsql = getNeonSql();

    // ── 1. Provision the low-privilege app role (idempotent) ───────────────
    // APP_ROLE is a compile-time constant. We use nsql([rawString]) — the
    // single-element array form — to send the DO block without any $N
    // parameters, which Postgres requires for DO blocks.
    await nsql([
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
           CREATE ROLE ${APP_ROLE} LOGIN PASSWORD 'rls_test_only';
         END IF;
       END $$`,
    ] as unknown as TemplateStringsArray);

    // Grant table-level privileges so queries as cema_app_user don't fail on
    // "permission denied for table" before RLS even applies.
    // GRANT is idempotent — safe to run on every test run.
    await nsql([
      `GRANT SELECT, INSERT, UPDATE, DELETE ON deals TO ${APP_ROLE}`,
    ] as unknown as TemplateStringsArray);
    await nsql([
      `GRANT SELECT, INSERT ON organizations TO ${APP_ROLE}`,
    ] as unknown as TemplateStringsArray);
    await nsql([`GRANT SELECT, INSERT ON users TO ${APP_ROLE}`] as unknown as TemplateStringsArray);

    // neondb_owner must be a member of cema_app_user to be allowed to
    // SET ROLE to it (Postgres requirement for non-superusers).
    await nsql([`GRANT ${APP_ROLE} TO neondb_owner`] as unknown as TemplateStringsArray);

    // ── 2. Seed org and user rows ──────────────────────────────────────────
    // Inserted as neondb_owner (BYPASSRLS=true) — no RLS context needed here.
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
