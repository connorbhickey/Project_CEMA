import { describe, expect, it } from 'vitest';

import { summarizeDealGraph, type DealGraphEdge } from './deal-graph-view';

const edge = (
  subjectId: string,
  predicate: string,
  objectId: string,
  subjectType = 'deal',
  objectType = 'document',
): DealGraphEdge => ({ subjectId, subjectType, predicate, objectId, objectType });

describe('summarizeDealGraph', () => {
  it('groups edges by predicate with a human label, in first-seen order', () => {
    const view = summarizeDealGraph([
      edge('deal-1', 'deal_has_instrument', 'doc-1'),
      edge('doc-1', 'chain_precedes', 'doc-2', 'document'),
      edge('deal-1', 'deal_has_instrument', 'doc-2'),
    ]);
    expect(view.groups.map((g) => g.predicate)).toEqual(['deal_has_instrument', 'chain_precedes']);
    expect(view.groups[0]!.label).toBe('Collateral instruments');
    expect(view.groups[0]!.edges).toHaveLength(2);
    expect(view.groups[1]!.label).toBe('Assignment chain (recorded order)');
  });

  it('falls back to the raw predicate for an unlabeled kind', () => {
    const view = summarizeDealGraph([edge('deal-1', 'mystery_edge', 'x')]);
    expect(view.groups[0]!.label).toBe('mystery_edge');
  });

  it('orders chain_precedes edges into a path (head = a `from` never seen as a `to`)', () => {
    const view = summarizeDealGraph([
      edge('doc-2', 'chain_precedes', 'doc-3', 'document'),
      edge('doc-1', 'chain_precedes', 'doc-2', 'document'),
    ]);
    expect(view.chainPath).toEqual(['doc-1', 'doc-2', 'doc-3']);
  });

  it('returns an empty chain path when there are no chain edges', () => {
    expect(summarizeDealGraph([edge('deal-1', 'deal_has_instrument', 'doc-1')]).chainPath).toEqual(
      [],
    );
  });

  it('bails to empty (does not fabricate) on a cyclic chain with no clean head', () => {
    const view = summarizeDealGraph([
      edge('doc-1', 'chain_precedes', 'doc-2', 'document'),
      edge('doc-2', 'chain_precedes', 'doc-1', 'document'),
    ]);
    expect(view.chainPath).toEqual([]);
  });

  it('returns no groups for no edges', () => {
    expect(summarizeDealGraph([])).toEqual({ groups: [], chainPath: [] });
  });
});
