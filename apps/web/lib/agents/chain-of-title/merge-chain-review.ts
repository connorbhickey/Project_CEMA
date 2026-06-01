import type { RouteDecision } from '@cema/agents-chain-of-title';
import type { ChainBreakReviewState } from '@cema/attorney';

import { breakHash } from './break-hash';

// The persisted-row fields the deal review surface needs. A projection of
// chain_break_review_queue (the loader selects exactly these), kept minimal so
// the merge core stays pure and node-testable.
export interface ChainBreakReviewRow {
  id: string;
  breakHash: string;
  breakKind: string;
  state: ChainBreakReviewState;
  reviewerId: string | null;
}

// One live attorney_review finding joined to its persisted queue row (or null
// if the actuator has not yet enqueued it).
export interface ChainReviewItem {
  decision: RouteDecision;
  breakHash: string;
  review: ChainBreakReviewRow | null;
}

export interface ChainReviewMerge {
  items: ChainReviewItem[];
  orphans: ChainBreakReviewRow[];
}

/**
 * Joins live attorney_review findings (recomputed each request from
 * documents.extractedData) to persisted queue rows by breakHash. Open rows whose
 * break is absent from the live recompute are "orphans" -- previously flagged,
 * no longer detected -- surfaced for manual dismissal and NEVER auto-resolved
 * (the agent's "never auto-bless" property, applied in reverse: a break vanishing
 * could mean a document was removed/reclassified, not that the defect was fixed,
 * so a human decides). Terminal rows (resolved/dismissed) are not orphans.
 */
export function mergeChainReview(
  attorneyRoutes: readonly RouteDecision[],
  rows: readonly ChainBreakReviewRow[],
): ChainReviewMerge {
  const rowByHash = new Map(rows.map((r) => [r.breakHash, r]));
  const liveHashes = new Set<string>();

  const items = attorneyRoutes.map((decision): ChainReviewItem => {
    const hash = breakHash(decision);
    liveHashes.add(hash);
    return { decision, breakHash: hash, review: rowByHash.get(hash) ?? null };
  });

  const orphans = rows.filter(
    (r) => !liveHashes.has(r.breakHash) && r.state !== 'resolved' && r.state !== 'dismissed',
  );

  return { items, orphans };
}
