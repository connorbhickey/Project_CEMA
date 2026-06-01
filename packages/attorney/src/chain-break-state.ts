// ---------------------------------------------------------------------------
// Chain-of-Title Tier 2 review queue state machine (M14).
//
// A sibling to state.ts (the document-review machine). Kept separate so the
// gate-critical document path is untouched; the shape matches, the terminal
// names are chain-correct.
//
// Valid transitions:
//   pending   → claimed             (attorney claims a chain break)
//   claimed   → pending             (attorney releases / unclaims)
//   claimed   → resolved            (defect remedied — lost-note affidavit,
//                                     corrective/re-recorded assignment, etc.)
//   claimed   → dismissed           (not a real defect — false positive)
//   resolved  → (none)              terminal
//   dismissed → (none)              terminal
// ---------------------------------------------------------------------------

export type ChainBreakReviewState = 'pending' | 'claimed' | 'resolved' | 'dismissed';

const TRANSITIONS: Record<ChainBreakReviewState, ChainBreakReviewState[]> = {
  pending: ['claimed'],
  claimed: ['pending', 'resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};

/**
 * Returns true when transitioning from `from` to `to` is a valid move in the
 * chain-break review state machine.
 */
export function canTransitionChainBreak(
  from: ChainBreakReviewState,
  to: ChainBreakReviewState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Returns the list of states reachable from `from`. Empty for terminal states.
 */
export function validChainBreakTransitions(from: ChainBreakReviewState): ChainBreakReviewState[] {
  return [...TRANSITIONS[from]];
}

/**
 * Returns true when `state` is terminal (the review outcome is final).
 */
export function isTerminalChainBreak(state: ChainBreakReviewState): boolean {
  return state === 'resolved' || state === 'dismissed';
}
