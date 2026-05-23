'use server';

import { canTransition } from '@cema/attorney';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { documentReviewQueue, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export class ReviewClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewClaimError';
  }
}

export interface ClaimReviewResult {
  queueId: string;
  reviewerId: string;
  state: 'claimed';
}

export async function claimReview(queueId: string): Promise<ClaimReviewResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new ReviewClaimError('Not authenticated');

  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new ReviewClaimError('Organization not found');

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!user) throw new ReviewClaimError('User not synced yet');

  const result = await withRls(org.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(documentReviewQueue)
      .where(eq(documentReviewQueue.id, queueId))
      .limit(1);

    if (!row) throw new ReviewClaimError(`Queue row ${queueId} not found`);
    if (!canTransition(row.state, 'claimed')) {
      throw new ReviewClaimError(`Cannot claim review in state ${row.state}`);
    }

    await tx
      .update(documentReviewQueue)
      .set({ state: 'claimed', reviewerId: user.id, claimedAt: new Date(), updatedAt: new Date() })
      .where(eq(documentReviewQueue.id, queueId));

    return { queueId: row.id, reviewerId: user.id, state: 'claimed' as const };
  });

  await emitAuditEvent(db, {
    organizationId: org.id,
    actorUserId: user.id,
    action: 'document.review_claimed',
    entityType: 'document_review_queue',
    entityId: result.queueId,
    metadata: { reviewerId: result.reviewerId },
  });

  return result;
}
