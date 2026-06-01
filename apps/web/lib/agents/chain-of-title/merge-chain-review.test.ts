import type { RouteDecision } from '@cema/agents-chain-of-title';
import { describe, expect, it } from 'vitest';

import { breakHash } from './break-hash';
import { mergeChainReview, type ChainBreakReviewRow } from './merge-chain-review';

const decision = (documentId: string | null, reason: string): RouteDecision => ({
  dealId: 'deal-1',
  kind: 'attorney_review',
  breakKind: 'lost_note',
  documentId,
  reason,
});

const row = (over: Partial<ChainBreakReviewRow> & { breakHash: string }): ChainBreakReviewRow => ({
  id: 'q1',
  breakKind: 'lost_note',
  state: 'pending',
  reviewerId: null,
  ...over,
});

describe('mergeChainReview', () => {
  it('joins a live attorney_review finding to its persisted row by breakHash', () => {
    const d = decision('doc-1', 'Orphaned note with no recorded anchor.');
    const r = row({ breakHash: breakHash(d) });
    const result = mergeChainReview([d], [r]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.breakHash).toBe(breakHash(d));
    expect(result.items[0]?.review?.id).toBe('q1');
    expect(result.orphans).toHaveLength(0);
  });

  it('reports a live finding with no persisted row as review:null', () => {
    const d = decision('doc-1', 'x');
    const result = mergeChainReview([d], []);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.review).toBeNull();
  });

  it('reports an open row whose break is no longer detected as an orphan', () => {
    const stale = row({ id: 'q9', breakHash: 'deadbeef' });
    const result = mergeChainReview([], [stale]);
    expect(result.items).toHaveLength(0);
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0]?.id).toBe('q9');
  });

  it('does NOT treat a terminal (resolved/dismissed) stale row as an orphan', () => {
    const resolved = row({ breakHash: 'deadbeef', state: 'resolved' });
    const dismissed = row({ breakHash: 'cafebabe', state: 'dismissed' });
    const result = mergeChainReview([], [resolved, dismissed]);
    expect(result.orphans).toHaveLength(0);
  });

  it('does not double-count a row that matches a live finding (not an orphan)', () => {
    const d = decision(null, 'gap');
    const matched = row({ breakHash: breakHash(d) });
    const result = mergeChainReview([d], [matched]);
    expect(result.items[0]?.review?.id).toBe('q1');
    expect(result.orphans).toHaveLength(0);
  });
});
