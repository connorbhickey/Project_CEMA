import { describe, expect, it } from 'vitest';

import { partyEdges } from './party-edges';

describe('partyEdges', () => {
  it('maps each party id to a PII-safe party_is_on_deal edge (party -> deal)', () => {
    expect(partyEdges('org-1', 'deal-1', ['p1', 'p2'])).toEqual([
      {
        organizationId: 'org-1',
        subjectId: 'p1',
        subjectType: 'party',
        predicate: 'party_is_on_deal',
        objectId: 'deal-1',
        objectType: 'deal',
      },
      {
        organizationId: 'org-1',
        subjectId: 'p2',
        subjectType: 'party',
        predicate: 'party_is_on_deal',
        objectId: 'deal-1',
        objectType: 'deal',
      },
    ]);
  });

  it('returns an empty array when the deal has no parties', () => {
    expect(partyEdges('org-1', 'deal-1', [])).toEqual([]);
  });
});
