import type { ChainBreakReviewState } from '@cema/attorney';

/**
 * Authorization for a chain-break transition. Claiming (`-> claimed`) is open to
 * any org member; releasing / resolving / dismissing is restricted to the
 * reviewer who holds the claim — mirroring the document-review actions
 * (approve-document / reject-document), which gate terminal moves on
 * `reviewerId === user.id`. Pure + node-testable; RLS only enforces org
 * isolation, not per-claimer ownership within the org.
 */
export function isChainBreakActorAuthorized(
  toState: ChainBreakReviewState,
  reviewerId: string | null,
  userId: string,
): boolean {
  if (toState === 'claimed') return true;
  return reviewerId === userId;
}

export interface ChainBreakTransitionFields {
  state: ChainBreakReviewState;
  reviewerId?: string | null;
  claimedAt?: Date | null;
  decidedAt?: Date | null;
  resolutionNote?: string | null;
  updatedAt: Date;
}

/**
 * Pure mapping from a target state to the chain_break_review_queue column
 * updates, with the clock injected (durable-replay safe, node-testable). Encodes
 * the lifecycle invariants the DB CHECKs also enforce:
 *   - claim   -> set reviewer + claimedAt
 *   - release -> clear reviewer + claimedAt
 *   - resolve/dismiss -> set decidedAt + note; reviewer/claimedAt left untouched
 *     (the claimer is the resolver). Only terminal states get decidedAt / a note,
 *     satisfying the *_requires_terminal CHECKs.
 * Fields left undefined are omitted from the Drizzle .set(), so the row keeps its
 * current value (e.g. reviewerId on a resolve).
 */
export function chainBreakReviewTransitionFields(
  toState: ChainBreakReviewState,
  userId: string,
  now: Date,
  note?: string,
): ChainBreakTransitionFields {
  const base = { state: toState, updatedAt: now };
  switch (toState) {
    case 'claimed':
      return { ...base, reviewerId: userId, claimedAt: now };
    case 'pending':
      return { ...base, reviewerId: null, claimedAt: null };
    case 'resolved':
    case 'dismissed':
      return { ...base, decidedAt: now, resolutionNote: note ?? null };
  }
}
