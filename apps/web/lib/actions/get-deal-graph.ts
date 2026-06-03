'use server';

import { getCurrentOrganizationId } from '@cema/auth';
import { getDb } from '@cema/db';
import { findNeighbors } from '@cema/kg';

import { type DealGraphEdge } from '../kg/deal-graph-view';
import { withRls } from '../with-rls';

export interface DealGraphResult {
  dealId: string;
  edges: DealGraphEdge[];
}

/**
 * Returns the deal's knowledge-graph relationships: the deal's outbound edges
 * (membership — deal_has_instrument, etc.) plus the chain_precedes edges among
 * its instrument documents (the recorded assignment sequence). Built on the
 * findNeighbors primitive (which carries predicates) under RLS. PII-safe: node
 * ids + predicate enums only.
 */
export async function getDealGraph(dealId: string): Promise<DealGraphResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');

  const edges = await withRls(org.id, async (tx) => {
    const dealNeighbors = await findNeighbors(tx, {
      organizationId: org.id,
      nodeId: dealId,
      nodeType: 'deal',
    });

    const out: DealGraphEdge[] = dealNeighbors.map((n) => ({
      subjectId: dealId,
      subjectType: 'deal',
      predicate: n.predicate,
      objectId: n.nodeId,
      objectType: n.nodeType,
    }));

    // Follow the chain_precedes sequence out of each document neighbor.
    const docIds = dealNeighbors.filter((n) => n.nodeType === 'document').map((n) => n.nodeId);
    for (const docId of docIds) {
      const succ = await findNeighbors(tx, {
        organizationId: org.id,
        nodeId: docId,
        nodeType: 'document',
        predicate: 'chain_precedes',
      });
      for (const s of succ) {
        out.push({
          subjectId: docId,
          subjectType: 'document',
          predicate: 'chain_precedes',
          objectId: s.nodeId,
          objectType: s.nodeType,
        });
      }
    }

    return out;
  });

  return { dealId, edges };
}
