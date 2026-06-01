import type { AddEdgeInput } from '@cema/kg';

/**
 * Pure mapper: one PII-safe `deal -> document` KG edge (predicate
 * `deal_has_instrument`) per IDP-classified collateral instrument document.
 * Carries only ids + static token fields — never party names or extractedData
 * (hard rule #3). The deal is the edge SUBJECT, so no deal_id column is needed.
 * Node-testable (no DB); the effectful addEdge runs in index-deal-instrument-edges.
 */
export function instrumentEdges(
  organizationId: string,
  dealId: string,
  instrumentDocumentIds: readonly string[],
): AddEdgeInput[] {
  return instrumentDocumentIds.map((documentId) => ({
    organizationId,
    subjectId: dealId,
    subjectType: 'deal',
    predicate: 'deal_has_instrument',
    objectId: documentId,
    objectType: 'document',
  }));
}
