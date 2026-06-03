import type { ChainSequenceEdge } from '@cema/agents-chain-of-title';
import type { AddEdgeInput } from '@cema/kg';

/**
 * Pure mapper: one PII-safe `document -> document` KG edge (predicate
 * `chain_precedes`) per recorded assignment-sequence edge. Carries only document
 * ids (hard rule #3). Node-testable; the effectful addEdge runs in
 * index-deal-chain-edges.
 */
export function chainEdges(
  organizationId: string,
  sequence: readonly ChainSequenceEdge[],
): AddEdgeInput[] {
  return sequence.map((e) => ({
    organizationId,
    subjectId: e.fromDocumentId,
    subjectType: 'document',
    predicate: 'chain_precedes',
    objectId: e.toDocumentId,
    objectType: 'document',
  }));
}
