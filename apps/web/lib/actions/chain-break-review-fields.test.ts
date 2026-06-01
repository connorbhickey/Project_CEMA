import { describe, expect, it } from 'vitest';

import {
  chainBreakReviewTransitionFields,
  isChainBreakActorAuthorized,
} from './chain-break-review-fields';

const NOW = new Date('2026-06-01T00:00:00.000Z');

describe('isChainBreakActorAuthorized', () => {
  it('lets any org member claim (no reviewer yet)', () => {
    expect(isChainBreakActorAuthorized('claimed', null, 'user-1')).toBe(true);
  });

  it('lets only the claiming reviewer resolve / dismiss / release', () => {
    expect(isChainBreakActorAuthorized('resolved', 'user-1', 'user-1')).toBe(true);
    expect(isChainBreakActorAuthorized('dismissed', 'user-1', 'user-1')).toBe(true);
    expect(isChainBreakActorAuthorized('pending', 'user-1', 'user-1')).toBe(true);
  });

  it('blocks a non-claimer from resolving / dismissing / releasing', () => {
    expect(isChainBreakActorAuthorized('resolved', 'user-1', 'user-2')).toBe(false);
    expect(isChainBreakActorAuthorized('dismissed', 'user-1', 'user-2')).toBe(false);
    expect(isChainBreakActorAuthorized('pending', 'user-1', 'user-2')).toBe(false);
  });
});

describe('chainBreakReviewTransitionFields', () => {
  it('claim sets reviewerId + claimedAt (not decidedAt/note)', () => {
    const f = chainBreakReviewTransitionFields('claimed', 'user-1', NOW);
    expect(f).toEqual({ state: 'claimed', reviewerId: 'user-1', claimedAt: NOW, updatedAt: NOW });
    expect(f.decidedAt).toBeUndefined();
    expect(f.resolutionNote).toBeUndefined();
  });

  it('release (-> pending) clears reviewerId + claimedAt', () => {
    const f = chainBreakReviewTransitionFields('pending', 'user-1', NOW);
    expect(f).toEqual({ state: 'pending', reviewerId: null, claimedAt: null, updatedAt: NOW });
  });

  it('resolved sets decidedAt + note and leaves reviewerId untouched (the claimer resolves)', () => {
    const f = chainBreakReviewTransitionFields('resolved', 'user-1', NOW, 'located in vault');
    expect(f).toEqual({
      state: 'resolved',
      decidedAt: NOW,
      resolutionNote: 'located in vault',
      updatedAt: NOW,
    });
    expect(f.reviewerId).toBeUndefined();
    expect(f.claimedAt).toBeUndefined();
  });

  it('dismissed without a note stores null (DB CHECK allows null on terminal)', () => {
    const f = chainBreakReviewTransitionFields('dismissed', 'user-1', NOW);
    expect(f.state).toBe('dismissed');
    expect(f.decidedAt).toEqual(NOW);
    expect(f.resolutionNote).toBeNull();
  });
});
