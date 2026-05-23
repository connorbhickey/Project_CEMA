// ---------------------------------------------------------------------------
// Attorney review queue state machine (M5 task 14).
//
// Valid transitions:
//   pending  → claimed             (reviewer claims a queue item)
//   claimed  → pending             (reviewer releases / unclaims)
//   claimed  → approved            (reviewer approves)
//   claimed  → rejected            (reviewer rejects)
//   approved → (none)              terminal
//   rejected → (none)              terminal
// ---------------------------------------------------------------------------

export type ReviewState = 'pending' | 'claimed' | 'approved' | 'rejected';

const TRANSITIONS: Record<ReviewState, ReviewState[]> = {
  pending: ['claimed'],
  claimed: ['pending', 'approved', 'rejected'],
  approved: [],
  rejected: [],
};

/**
 * Returns true when transitioning from `from` to `to` is a valid move
 * in the review state machine.
 */
export function canTransition(from: ReviewState, to: ReviewState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Returns the list of states reachable from `from`.
 * Returns an empty array for terminal states.
 */
export function validTransitions(from: ReviewState): ReviewState[] {
  return [...TRANSITIONS[from]];
}

/**
 * Returns true when `state` is a terminal state (no further transitions
 * are possible and the review outcome is final).
 */
export function isTerminal(state: ReviewState): boolean {
  return state === 'approved' || state === 'rejected';
}
