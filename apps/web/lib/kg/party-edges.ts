import type { AddEdgeInput } from '@cema/kg';

/**
 * Pure mapper: one PII-safe `party -> deal` KG edge (predicate
 * `party_is_on_deal`) per party on the deal. Carries only ids (party id, deal
 * id) -- never party names or roles (hard rule #3). Node-testable (no DB); the
 * effectful addEdge runs in index-deal-party-edges. Mirrors instrumentEdges.
 */
export function partyEdges(
  organizationId: string,
  dealId: string,
  partyIds: readonly string[],
): AddEdgeInput[] {
  return partyIds.map((partyId) => ({
    organizationId,
    subjectId: partyId,
    subjectType: 'party',
    predicate: 'party_is_on_deal',
    objectId: dealId,
    objectType: 'deal',
  }));
}
