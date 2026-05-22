/**
 * RLS multi-tenant isolation — communications + recordings (M2 Task 25).
 *
 * Proves that migration 0011_rls_telephony.sql correctly isolates rows
 * across organizations through the production withRls() path.
 *
 * Two policy shapes are exercised here:
 *   • communications — direct organization_id equality
 *   • recordings     — EXISTS via communications (no own org column)
 *
 * The plan calls for three cross-org assertions: SELECT, UPDATE, DELETE.
 * Positive-case (Org A sees own data) assertions are included to catch
 * over-restriction regressions that would manifest as false positives on
 * the isolation tests.
 *
 * ─── Why neondb_owner for setup? ─────────────────────────────────────────
 * neondb_owner has BYPASSRLS=true, letting us seed Org A's rows without
 * needing a valid RLS context. withRls() downgrades to cema_app_user
 * (BYPASSRLS=false) for each assertion, so the RLS policies actually fire.
 *
 * ─── Why is this a separate file from withrls-enforcement.test.ts? ───────
 * That file targets deals/organizations (M1 tables). This file owns the M2
 * tables (communications, recordings). Keeping them separate makes the
 * regression surface obvious when either policy layer changes.
 */

import { communications, getDb, organizations, recordings, users } from '@cema/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const ORG_A_ID = '00000000-0000-0000-0000-0000000000a2';
const ORG_B_ID = '00000000-0000-0000-0000-0000000000b2';
const USER_ID = '00000000-0000-0000-0000-000000000092';

// Skip when DATABASE_URL is absent (e.g. CI without the Neon secret).
const skip = !process.env.DATABASE_URL;

// Set in beforeAll; shared across test cases.
let commAId: string;
let recAId: string;

describe.skipIf(skip)('RLS — communications + recordings cross-org isolation', () => {
  beforeAll(async () => {
    const db = getDb();

    await db
      .insert(organizations)
      .values([
        {
          id: ORG_A_ID,
          clerkOrgId: 'org_comm_rls_test_a',
          name: 'Org A (Comm RLS Test)',
          slug: 'comm-rls-test-org-a',
        },
        {
          id: ORG_B_ID,
          clerkOrgId: 'org_comm_rls_test_b',
          name: 'Org B (Comm RLS Test)',
          slug: 'comm-rls-test-org-b',
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_comm_rls_test',
        email: 'comm-rls-test@example.invalid',
      })
      .onConflictDoNothing();

    // Insert a communication for Org A as neondb_owner (BYPASSRLS=true).
    // kind='call' requires provider per the CHECK constraint in migration 0007.
    const [aComm] = await db
      .insert(communications)
      .values({
        organizationId: ORG_A_ID,
        kind: 'call',
        direction: 'outbound',
        medium: 'phone_softphone',
        provider: 'twilio',
        fromE164: '+12125550001',
        toE164: '+12125550002',
        status: 'pending',
      })
      .returning();

    commAId = aComm!.id;

    // Insert a recording for Org A's communication.
    // retentionUntil must be > created_at per CHECK recordings_retention_future.
    const [aRec] = await db
      .insert(recordings)
      .values({
        communicationId: commAId,
        recordingBlobUrl: 'https://blob.example.invalid/test-recording.wav',
        recordingBlobPathname: `org/${ORG_A_ID}/communications/${commAId}/recording.wav`,
        retentionUntil: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000),
      })
      .returning();

    recAId = aRec!.id;
  });

  afterAll(async () => {
    // Cleanup as neondb_owner — BYPASSRLS=true reaches across orgs.
    const db = getDb();
    await db.delete(recordings).where(eq(recordings.id, recAId));
    await db
      .delete(communications)
      .where(inArray(communications.organizationId, [ORG_A_ID, ORG_B_ID]));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_A_ID, ORG_B_ID]));
    await db.delete(users).where(eq(users.id, USER_ID));
  });

  // ── SELECT isolation ─────────────────────────────────────────────────────

  it('Org B cannot SELECT Org A communications via withRls', async () => {
    const visible = await withRls(ORG_B_ID, async (tx) =>
      tx
        .select({ id: communications.id })
        .from(communications)
        .where(eq(communications.id, commAId)),
    );
    expect(visible).toHaveLength(0);
  });

  it('Org A sees its own communications via withRls', async () => {
    const visible = await withRls(ORG_A_ID, async (tx) =>
      tx
        .select({ id: communications.id, organizationId: communications.organizationId })
        .from(communications)
        .where(eq(communications.id, commAId)),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]!.organizationId).toBe(ORG_A_ID);
  });

  it('Org B cannot SELECT Org A recordings via withRls (EXISTS-join policy)', async () => {
    const visible = await withRls(ORG_B_ID, async (tx) =>
      tx.select({ id: recordings.id }).from(recordings).where(eq(recordings.id, recAId)),
    );
    expect(visible).toHaveLength(0);
  });

  it('Org A sees its own recordings via withRls', async () => {
    const visible = await withRls(ORG_A_ID, async (tx) =>
      tx
        .select({ id: recordings.id, communicationId: recordings.communicationId })
        .from(recordings)
        .where(eq(recordings.id, recAId)),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]!.communicationId).toBe(commAId);
  });

  // ── UPDATE isolation ─────────────────────────────────────────────────────

  it('Org B UPDATE on Org A communication affects 0 rows (row filtered by RLS)', async () => {
    const updated = await withRls(ORG_B_ID, async (tx) =>
      tx
        .update(communications)
        .set({ status: 'failed' })
        .where(eq(communications.id, commAId))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    // Verify the row is unchanged when read as neondb_owner (no RLS filter).
    const db = getDb();
    const [current] = await db
      .select({ status: communications.status })
      .from(communications)
      .where(eq(communications.id, commAId));
    expect(current!.status).toBe('pending');
  });

  // ── DELETE isolation ─────────────────────────────────────────────────────

  it('Org B DELETE on Org A communication affects 0 rows (row filtered by RLS)', async () => {
    const deleted = await withRls(ORG_B_ID, async (tx) =>
      tx.delete(communications).where(eq(communications.id, commAId)).returning(),
    );
    expect(deleted).toHaveLength(0);

    // Confirm the row still exists as neondb_owner.
    const db = getDb();
    const [current] = await db
      .select({ id: communications.id })
      .from(communications)
      .where(eq(communications.id, commAId));
    expect(current).toBeTruthy();
  });
});
