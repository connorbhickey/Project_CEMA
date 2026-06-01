import type { ChainResult, RouteDecision } from '@cema/agents-chain-of-title';
import { describe, expect, it } from 'vitest';

import { hasReChase } from './collateral-pipeline-core';

function route(kind: RouteDecision['kind']): RouteDecision {
  return { dealId: 'deal-1', kind, documentId: null, reason: 'x' };
}

function chain(routes: RouteDecision[], status: ChainResult['status']): ChainResult {
  return { dealId: 'deal-1', status, breaks: [], routes };
}

describe('hasReChase', () => {
  it('is true when any route is re_chase', () => {
    expect(hasReChase(chain([route('attorney_review'), route('re_chase')], 'broken'))).toBe(true);
  });

  it('is false when no route is re_chase', () => {
    expect(hasReChase(chain([route('attorney_review'), route('advisory_pass')], 'ambiguous'))).toBe(
      false,
    );
  });

  it('is false for an empty route list (a clean chain)', () => {
    expect(hasReChase(chain([], 'clean'))).toBe(false);
  });
});
