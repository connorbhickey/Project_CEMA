/**
 * Audit-log immutability — Phase 0 M2 carry-over (ADR-0001 §"Negative" #2).
 *
 * Verifies the BEFORE UPDATE/DELETE triggers from migration
 * 0003_audit_immutability.sql actually fire on both `audit_events` and
 * `attorney_approvals`. Even `neondb_owner` (BYPASSRLS=true, the seed
 * role used by this test) is blocked by the triggers — only DROP TRIGGER
 * or ALTER TABLE … DISABLE TRIGGER would re-enable mutation.
 *
 * The triggers raise SQLSTATE '23514' (check_violation) which surfaces in
 * Postgres errors as the seeded HINT. We assert the error fires; we don't
 * deeply inspect the message because Postgres/Neon wording may drift
 * across versions.
 */

import {
  attorneyApprovals,
  auditEvents,
  deals,
  documents,
  getDb,
  organizations,
  users,
} from '@cema/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORG_ID = '00000000-0000-0000-0000-0000000000c1';
const USER_ID = '00000000-0000-0000-0000-0000000000c2';
const DEAL_ID = '00000000-0000-0000-0000-0000000000c3';
const DOC_ID = '00000000-0000-0000-0000-0000000000c4';
const AUDIT_ID = '00000000-0000-0000-0000-0000000000c5';
const APPROVAL_ID = '00000000-0000-0000-0000-0000000000c6';

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('audit log + attorney approvals are append-only (DB triggers)', () => {
  beforeAll(async () => {
    const db = getDb();

    // Seed: org → user → deal → document → audit event + attorney approval.
    // All idempotent via ON CONFLICT DO NOTHING so the test is re-runnable.
    await db
      .insert(organizations)
      .values({
        id: ORG_ID,
        clerkOrgId: 'org_audit_immutability_test',
        name: 'Org (audit immutability test)',
        slug: 'audit-immutability-test-org',
      })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_audit_immutability_test',
        email: 'audit-immutability-test@example.invalid',
      })
      .onConflictDoNothing();

    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_ID,
        cemaType: 'refi_cema',
        createdById: USER_ID,
      })
      .onConflictDoNothing();

    await db
      .insert(documents)
      .values({
        id: DOC_ID,
        dealId: DEAL_ID,
        kind: 'cema_3172', // attorney-gate-required kind
        attorneyReviewRequired: true,
      })
      .onConflictDoNothing();

    await db
      .insert(auditEvents)
      .values({
        id: AUDIT_ID,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        action: 'audit.immutability.test.seed',
        entityType: 'test',
        entityId: DEAL_ID,
        metadata: {},
      })
      .onConflictDoNothing();

    await db
      .insert(attorneyApprovals)
      .values({
        id: APPROVAL_ID,
        documentId: DOC_ID,
        documentVersion: 1,
        approvedById: USER_ID,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // Cleanup intentionally omitted for audit_events + attorney_approvals
    // (the triggers we're testing block DELETE). The seeded UUIDs are
    // stable and namespaced, so re-running the test is idempotent.
    // We clean up the upstream rows because their cascade would normally
    // reach the immutable tables — DISABLE TRIGGER would let us, but
    // leaving rows behind is the simpler, harmless choice for a dev branch.
  });

  it('UPDATE on audit_events raises check_violation', async () => {
    const db = getDb();
    await expect(
      db.execute(sql`UPDATE audit_events SET action = 'tampered' WHERE id = ${AUDIT_ID}`),
    ).rejects.toThrow(/append-only|UPDATE\/DELETE blocked/i);
  });

  it('DELETE on audit_events raises check_violation', async () => {
    const db = getDb();
    await expect(db.execute(sql`DELETE FROM audit_events WHERE id = ${AUDIT_ID}`)).rejects.toThrow(
      /append-only|UPDATE\/DELETE blocked/i,
    );
  });

  it('UPDATE on attorney_approvals raises check_violation', async () => {
    const db = getDb();
    await expect(
      db.execute(sql`UPDATE attorney_approvals SET notes = 'tampered' WHERE id = ${APPROVAL_ID}`),
    ).rejects.toThrow(/append-only|UPDATE\/DELETE blocked/i);
  });

  it('DELETE on attorney_approvals raises check_violation', async () => {
    const db = getDb();
    await expect(
      db.execute(sql`DELETE FROM attorney_approvals WHERE id = ${APPROVAL_ID}`),
    ).rejects.toThrow(/append-only|UPDATE\/DELETE blocked/i);
  });
});
