import { describe, expect, it } from 'vitest';

import { chainEdges } from './chain-edges';

describe('chainEdges', () => {
  it('maps each sequence edge to a document -> document chain_precedes KG edge', () => {
    const out = chainEdges('org-1', [
      { fromDocumentId: 'a1', toDocumentId: 'a2' },
      { fromDocumentId: 'a2', toDocumentId: 'a3' },
    ]);
    expect(out).toEqual([
      {
        organizationId: 'org-1',
        subjectId: 'a1',
        subjectType: 'document',
        predicate: 'chain_precedes',
        objectId: 'a2',
        objectType: 'document',
      },
      {
        organizationId: 'org-1',
        subjectId: 'a2',
        subjectType: 'document',
        predicate: 'chain_precedes',
        objectId: 'a3',
        objectType: 'document',
      },
    ]);
  });

  it('returns no edges for an empty sequence', () => {
    expect(chainEdges('org-1', [])).toEqual([]);
  });
});
