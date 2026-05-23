'use server';

import { canTransition } from '@cema/attorney';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import {
  attorneyApprovals,
  documentReviewQueue,
  documents,
  getDb,
  organizations,
  users,
} from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

// ---------------------------------------------------------------------------
// Hard rule #2 enforcement — approveDocument is the action that creates the
// AttorneyApproval row. sendEnvelope checks for the existence of this row
// before it will create a DocuSign envelope. Without this row, no envelope
// can be sent for attorney-review-required documents.
// ---------------------------------------------------------------------------

export class ReviewDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewDecisionError';
  }
}

export interface ApproveDocumentResult {
  queueId: string;
  approvalId: string;
}

export async function approveDocument(queueId: string): Promise<ApproveDocumentResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new ReviewDecisionError('Not authenticated');

  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new ReviewDecisionError('Organization not found');

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!user) throw new ReviewDecisionError('User not synced yet');

  const result = await withRls(org.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(documentReviewQueue)
      .where(eq(documentReviewQueue.id, queueId))
      .limit(1);

    if (!row) throw new ReviewDecisionError(`Queue row ${queueId} not found`);
    if (row.reviewerId !== user.id) {
      throw new ReviewDecisionError('Only the reviewer who claimed this review can approve');
    }
    if (!canTransition(row.state, 'approved')) {
      throw new ReviewDecisionError(`Cannot approve from state ${row.state}`);
    }

    // This is the AttorneyApproval row that M4 sendEnvelope looks up.
    // Hard rule #2: without this row, sendEnvelope throws AttorneyReviewMissingError.
    const [approval] = await tx
      .insert(attorneyApprovals)
      .values({
        documentId: row.documentId,
        documentVersion: row.documentVersion,
        approvedById: user.id,
      })
      .returning();
    if (!approval) throw new ReviewDecisionError('Failed to insert attorney_approvals row');

    await tx
      .update(documentReviewQueue)
      .set({ state: 'approved', decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(documentReviewQueue.id, queueId));

    await tx
      .update(documents)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(documents.id, row.documentId));

    return { queueId: row.id, approvalId: approval.id };
  });

  await emitAuditEvent(db, {
    organizationId: org.id,
    actorUserId: user.id,
    action: 'document.approved',
    entityType: 'document_review_queue',
    entityId: result.queueId,
    metadata: { approvalId: result.approvalId },
  });

  return result;
}
