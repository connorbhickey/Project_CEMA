'use server';

import { canTransition } from '@cema/attorney';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { documentReviewQueue, documents, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

import { ReviewDecisionError } from './approve-document';

export async function rejectDocument(
  queueId: string,
  reason: string,
): Promise<{ queueId: string }> {
  if (!reason.trim()) {
    throw new ReviewDecisionError('Rejection reason is required');
  }

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
      throw new ReviewDecisionError('Only the reviewer who claimed this review can reject');
    }
    if (!canTransition(row.state, 'rejected')) {
      throw new ReviewDecisionError(`Cannot reject from state ${row.state}`);
    }

    await tx
      .update(documentReviewQueue)
      .set({
        state: 'rejected',
        decidedAt: new Date(),
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(documentReviewQueue.id, queueId));

    await tx
      .update(documents)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(documents.id, row.documentId));

    return { queueId: row.id };
  });

  await emitAuditEvent(db, {
    organizationId: org.id,
    actorUserId: user.id,
    action: 'document.rejected',
    entityType: 'document_review_queue',
    entityId: result.queueId,
    metadata: { reason },
  });

  return result;
}
