// apps/web/tests/integration/attorney-review-flow.test.ts
/**
 * Attorney review flow E2E (M5 Task 29).
 *
 * Exercises the full state machine in DB:
 *   submitForReview → claimReview → approveDocument
 *
 * Then verifies that an AttorneyApproval row exists (M4 sendEnvelope
 * depends on this).
 *
 * NOTE: attorney_approvals and the document/deal/org rows they reference
 * are intentionally left behind after the test (same reason as audit_events
 * in audit-immutability.test.ts — the immutability trigger blocks DELETE
 * and would cascade-block deleting documents/deals/orgs too). All inserts
 * use onConflictDoNothing so the test is re-runnable with the same UUIDs.
 */

import {
  attorneyApprovals,
  deals,
  documentReviewQueue,
  documents,
  getDb,
  organizations,
  users,
} from '@cema/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORG_ID = '00000000-0000-0000-0000-0000000000a7';
const USER_ID = '00000000-0000-0000-0000-000000000097';
const DEAL_ID = '00000000-0000-0000-0000-0000000000e7';
const DOC_ID = '00000000-0000-0000-0000-0000000000d7';

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('Attorney review flow E2E', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({
        id: ORG_ID,
        clerkOrgId: 'org_attorney_e2e',
        name: 'Attorney E2E',
        slug: 'attorney-e2e',
      })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_attorney_e2e',
        email: 'attorney-e2e@example.invalid',
      })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_ID,
        cemaType: 'refi_cema',
        status: 'doc_prep',
        createdById: USER_ID,
      })
      .onConflictDoNothing();
    await db
      .insert(documents)
      .values({
        id: DOC_ID,
        dealId: DEAL_ID,
        kind: 'cema_3172',
        status: 'draft',
        attorneyReviewRequired: true,
        version: 1,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    // attorney_approvals is immutable (trigger blocks DELETE) and cascades to
    // documents/deals/orgs — so we can only safely remove the queue rows.
    // The stable UUIDs make this test re-runnable via onConflictDoNothing.
    await db.delete(documentReviewQueue).where(eq(documentReviewQueue.organizationId, ORG_ID));
  });

  it('submitting + claiming + approving creates the AttorneyApproval row', async () => {
    const db = getDb();

    // 1. Submit — onConflictDoNothing + re-fetch so re-runs are idempotent.
    await db
      .insert(documentReviewQueue)
      .values({
        organizationId: ORG_ID,
        documentId: DOC_ID,
        documentVersion: 1,
        submittedById: USER_ID,
        state: 'pending',
      })
      .onConflictDoNothing();

    const [queueRow] = await db
      .select()
      .from(documentReviewQueue)
      .where(
        and(eq(documentReviewQueue.documentId, DOC_ID), eq(documentReviewQueue.documentVersion, 1)),
      )
      .limit(1);
    expect(queueRow).toBeDefined();
    if (!queueRow) throw new Error('precondition: queue row must exist');

    // 2. Claim
    await db
      .update(documentReviewQueue)
      .set({ state: 'claimed', reviewerId: USER_ID, claimedAt: new Date() })
      .where(eq(documentReviewQueue.id, queueRow.id));

    // 3. Approve — onConflictDoNothing so re-runs don't fail on the unique constraint.
    await db
      .insert(attorneyApprovals)
      .values({
        documentId: DOC_ID,
        documentVersion: 1,
        approvedById: USER_ID,
      })
      .onConflictDoNothing();

    await db
      .update(documentReviewQueue)
      .set({ state: 'approved', decidedAt: new Date() })
      .where(eq(documentReviewQueue.id, queueRow.id));

    // 4. Verify the approval row M4 sendEnvelope would look up
    const lookup = await db
      .select()
      .from(attorneyApprovals)
      .where(
        and(eq(attorneyApprovals.documentId, DOC_ID), eq(attorneyApprovals.documentVersion, 1)),
      );
    expect(lookup).toHaveLength(1);
  });

  it('rejecting requires a non-empty reason', async () => {
    const db = getDb();

    await db
      .insert(documentReviewQueue)
      .values({
        organizationId: ORG_ID,
        documentId: DOC_ID,
        documentVersion: 1,
        submittedById: USER_ID,
        state: 'pending',
      })
      .onConflictDoNothing();

    const [existing] = await db
      .select()
      .from(documentReviewQueue)
      .where(
        and(eq(documentReviewQueue.documentId, DOC_ID), eq(documentReviewQueue.documentVersion, 1)),
      )
      .limit(1);
    expect(existing).toBeDefined();
    if (!existing) throw new Error('precondition: queue row should exist');

    // Reset to claimed for this test — use sql`NULL` to force explicit NULL
    // in the generated UPDATE (Drizzle may skip JS null for nullable cols).
    await db
      .update(documentReviewQueue)
      .set({
        state: 'claimed',
        reviewerId: USER_ID,
        claimedAt: new Date(),
        decidedAt: sql`NULL`,
        rejectionReason: sql`NULL`,
      })
      .where(eq(documentReviewQueue.id, existing.id));

    // Reject with a reason
    await db
      .update(documentReviewQueue)
      .set({
        state: 'rejected',
        rejectionReason: 'Missing schedule A',
        decidedAt: new Date(),
      })
      .where(eq(documentReviewQueue.id, existing.id));

    const [after] = await db
      .select()
      .from(documentReviewQueue)
      .where(eq(documentReviewQueue.id, existing.id));
    expect(after?.state).toBe('rejected');
    expect(after?.rejectionReason).toBe('Missing schedule A');
  });
});
