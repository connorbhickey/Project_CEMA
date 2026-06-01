import type { ChainBreakReviewState } from '@cema/attorney';

export interface ChainQueueSummary {
  pending: number;
  claimed: number;
  total: number;
}

/**
 * Pure header summary for the cross-deal chain-break review queue. `total` is the
 * row count; `pending`/`claimed` are the open-state breakdown (a terminal row,
 * which the open-only inbox never shows, counts toward total but neither bucket).
 * Split out of the server query module so it unit-tests under node with no DB.
 */
export function chainQueueSummary(
  items: readonly { state: ChainBreakReviewState }[],
): ChainQueueSummary {
  let pending = 0;
  let claimed = 0;
  for (const item of items) {
    if (item.state === 'pending') pending += 1;
    else if (item.state === 'claimed') claimed += 1;
  }
  return { pending, claimed, total: items.length };
}
