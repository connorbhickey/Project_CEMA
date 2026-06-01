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
import {
  chainBreakReviewTransitionFields,
  isChainBreakActorAuthorized,
} from './chain-break-review-fields';

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

  const result = await withRls(org.id, async (tx) => {
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
    // Claiming is open; releasing/resolving/dismissing is the claimer's alone
    // (mirrors approve-document / reject-document). RLS only isolates by org.
    if (!isChainBreakActorAuthorized(toState, existing.reviewerId, user.id)) {
      throw new ChainBreakReviewError(
        'Only the reviewer who claimed this chain break can change it',
      );
    }

    await tx
      .update(chainBreakReviewQueue)
      .set(chainBreakReviewTransitionFields(toState, user.id, new Date(), note))
      .where(eq(chainBreakReviewQueue.id, queueId));

    // Co-transactional audit (mirrors openAttorneyReview): the transition and its
    // audit commit together or not at all (§10.5). chainBreakAuditMetadata never
    // carries the PII resolution_note (hard rule #3).
    await emitAuditEvent(tx, {
      organizationId: org.id,
      actorUserId: user.id,
      action: AUDIT_ACTION[toState],
      entityType: 'deal',
      entityId: existing.dealId,
      metadata: {
        queueId: existing.id,
        ...chainBreakAuditMetadata(existing, existing.state, toState),
      },
    });

    return { queueId: existing.id, dealId: existing.dealId };
  });

  revalidatePath(`/deals/${result.dealId}/documents`);
  return { queueId: result.queueId, state: toState };
}
