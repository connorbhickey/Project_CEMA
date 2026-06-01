'use server';

import { canTransitionChainBreak, type ChainBreakReviewState } from '@cema/attorney';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { chainBreakReviewQueue, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { chainBreakAuditMetadata } from '../agents/chain-of-title/chain-break-audit';
import { withRls } from '../with-rls';

import { ChainBreakReviewError } from './chain-break-errors';
import { chainBreakReviewTransitionFields } from './chain-break-review-fields';

const AUDIT_ACTION: Record<ChainBreakReviewState, string> = {
  claimed: 'chain_break.claimed',
  pending: 'chain_break.released',
  resolved: 'chain_break.resolved',
  dismissed: 'chain_break.dismissed',
};

export interface TransitionChainBreakResult {
  queueId: string;
  state: ChainBreakReviewState;
}

/**
 * Claim / release / resolve / dismiss a chain-break review item. The state
 * machine (canTransitionChainBreak) is the single validity source; the per-state
 * column updates come from the pure chainBreakReviewTransitionFields helper. The
 * PII-safe audit (chainBreakAuditMetadata) deliberately excludes the attorney's
 * free-text note (hard rule #3). revalidatePath refreshes the deal review surface.
 */
export async function transitionChainBreakReview(
  queueId: string,
  toState: ChainBreakReviewState,
  note?: string,
): Promise<TransitionChainBreakResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new ChainBreakReviewError('Not authenticated');

  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new ChainBreakReviewError('Organization not found');

  const user = await db.query.users.findFirst({ where: eq(users.clerkUserId, clerkUser.id) });
  if (!user) throw new ChainBreakReviewError('User not synced yet');

  const { row, fromState, dealId } = await withRls(org.id, async (tx) => {
    const [existing] = await tx
      .select()
      .from(chainBreakReviewQueue)
      .where(eq(chainBreakReviewQueue.id, queueId))
      .limit(1);
    if (!existing) throw new ChainBreakReviewError(`Chain-break review ${queueId} not found`);
    if (!canTransitionChainBreak(existing.state, toState)) {
      throw new ChainBreakReviewError(
        `Cannot move chain break from ${existing.state} to ${toState}`,
      );
    }

    await tx
      .update(chainBreakReviewQueue)
      .set(chainBreakReviewTransitionFields(toState, user.id, new Date(), note))
      .where(eq(chainBreakReviewQueue.id, queueId));

    return { row: existing, fromState: existing.state, dealId: existing.dealId };
  });

  await emitAuditEvent(db, {
    organizationId: org.id,
    actorUserId: user.id,
    action: AUDIT_ACTION[toState],
    entityType: 'deal',
    entityId: dealId,
    metadata: { queueId: row.id, ...chainBreakAuditMetadata(row, fromState, toState) },
  });

  revalidatePath(`/deals/${dealId}/documents`);
  return { queueId: row.id, state: toState };
}
