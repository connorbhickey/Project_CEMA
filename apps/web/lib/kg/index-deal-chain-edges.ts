import { chainSequenceEdges, type InstrumentRecord } from '@cema/agents-chain-of-title';
import { getCurrentOrganizationId } from '@cema/auth';
import { documents, getDb, organizations } from '@cema/db';
import { addEdge } from '@cema/kg';
import { eq } from 'drizzle-orm';

import { chainEdges } from './chain-edges';

import { isInstrumentRecord } from '@/lib/queries/deal-chain-findings';
import { withRls } from '@/lib/with-rls';

/**
 * Indexes a deal's recorded assignment sequence into the knowledge graph as
 * PII-safe `document -[chain_precedes]-> document` edges, so the chain of title
 * is traversable. Reads the InstrumentRecord[] the IDP enriched onto
 * documents.extractedData; the authoritative documents.id is stamped onto each
 * record (the KG node id), not trusted from extractedData. Idempotent: addEdge
 * uses onConflictDoNothing on the kg_edges unique index. Returns the edge count.
 */
export async function indexDealChainEdges(dealId: string): Promise<number> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return 0;

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({ id: documents.id, extractedData: documents.extractedData })
      .from(documents)
      .where(eq(documents.dealId, dealId));

    // Build InstrumentRecord[], stamping the authoritative documents.id as the
    // node id (defense-in-depth: do not trust extractedData.documentId). The
    // isInstrumentRecord guard narrows extractedData, so no cast is needed.
    const instruments: InstrumentRecord[] = [];
    for (const r of rows) {
      if (isInstrumentRecord(r.extractedData)) {
        instruments.push({ ...r.extractedData, documentId: r.id });
      }
    }

    const edges = chainEdges(org.id, chainSequenceEdges(instruments));
    for (const edge of edges) {
      await addEdge(tx, edge);
    }
    return edges.length;
  });
}
