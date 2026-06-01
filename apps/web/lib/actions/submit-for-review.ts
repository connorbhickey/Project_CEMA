'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { documentReviewQueue, documents, getDb, organizations, users } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

import { DocumentNotReviewableError } from './submit-for-review-errors';

// ---------------------------------------------------------------------------
// Hard rule #2 companion — submitForReview places a document into the
// attorney review queue. Until a queue row in state 'approved' exists for
// (document_id, document_version), sendEnvelope will throw
// AttorneyReviewMissingError.
//
// Idempotent: calling submitForReview twice for the same (documentId, version)
// returns the existing queue row rather than inserting a duplicate.
//
// DocumentNotReviewableError lives in ./submit-for-review-errors so this
// 'use server' module exports only async functions across the client boundary.
// ---------------------------------------------------------------------------

export interface SubmitForReviewResult {
  queueId: string;
  documentId: string;
  documentVersion: number;
}

export async function submitForReview(documentId: string): Promise<SubmitForReviewResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new Error('Not authenticated');

  const db = getDb();

  // Resolve internal org + user IDs from Clerk IDs
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');

  const submittingUser = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!submittingUser) throw new Error('User not synced yet');

  const result = await withRls(org.id, async (tx) => {
    // Fetch document under RLS — verifies ownership and reviewability.
    const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1);

    if (!doc) {
      throw new DocumentNotReviewableError(documentId, 'document not found');
    }
    if (!doc.attorneyReviewRequired) {
      throw new DocumentNotReviewableError(documentId, 'document does not require review');
    }

    // Idempotency: return existing queue row if one exists for this version.
    const [existing] = await tx
      .select()
      .from(documentReviewQueue)
      .where(
        and(
          eq(documentReviewQueue.documentId, documentId),
          eq(documentReviewQueue.documentVersion, doc.version),
        ),
      )
      .limit(1);

    if (existing) {
      return { queueId: existing.id, documentId: doc.id, documentVersion: doc.version };
    }

    // Insert queue row (pending state — no reviewer assigned yet).
    const [row] = await tx
      .insert(documentReviewQueue)
      .values({
        organizationId: org.id,
        documentId: doc.id,
        documentVersion: doc.version,
        submittedById: submittingUser.id,
        state: 'pending',
      })
      .returning();

    if (!row) throw new Error('Failed to insert document_review_queue row');

    // Flip the document status to attorney_review so the UI reflects the
    // pending-review state before the attorney claims and decides.
    await tx
      .update(documents)
      .set({ status: 'attorney_review', updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    return { queueId: row.id, documentId: doc.id, documentVersion: doc.version };
  });

  // Emit audit event outside the withRls transaction (audit log writes as owner role).
  await emitAuditEvent(db, {
    organizationId: org.id,
    actorUserId: submittingUser.id,
    action: 'document.submitted_for_review',
    entityType: 'document',
    entityId: result.documentId,
    metadata: { queueId: result.queueId, version: result.documentVersion },
  });

  return result;
}
