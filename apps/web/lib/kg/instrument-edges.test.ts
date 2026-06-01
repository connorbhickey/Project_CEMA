import { describe, expect, it } from 'vitest';

import { instrumentEdges } from './instrument-edges';

describe('instrumentEdges', () => {
  it('maps each instrument document id to a deal_has_instrument edge', () => {
    expect(instrumentEdges('org-1', 'deal-1', ['doc-a', 'doc-b'])).toEqual([
      {
        organizationId: 'org-1',
        subjectId: 'deal-1',
        subjectType: 'deal',
        predicate: 'deal_has_instrument',
        objectId: 'doc-a',
        objectType: 'document',
      },
      {
        organizationId: 'org-1',
        subjectId: 'deal-1',
        subjectType: 'deal',
        predicate: 'deal_has_instrument',
        objectId: 'doc-b',
        objectType: 'document',
      },
    ]);
  });

  it('returns no edges for an empty instrument set', () => {
    expect(instrumentEdges('org-1', 'deal-1', [])).toEqual([]);
  });

  it('carries no PII — only id + static token fields (no names, no metadata)', () => {
    const [edge] = instrumentEdges('org-1', 'deal-1', ['doc-a']);
    expect(Object.keys(edge!).sort()).toEqual([
      'objectId',
      'objectType',
      'organizationId',
      'predicate',
      'subjectId',
      'subjectType',
    ]);
  });
});
