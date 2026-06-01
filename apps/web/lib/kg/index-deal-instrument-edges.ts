import { getCurrentOrganizationId } from '@cema/auth';
import { documents, getDb, organizations } from '@cema/db';
import { addEdge } from '@cema/kg';
import { eq } from 'drizzle-orm';

import { instrumentEdges } from './instrument-edges';

import { isInstrumentRecord } from '@/lib/queries/deal-chain-findings';
import { withRls } from '@/lib/with-rls';

/**
 * Indexes a deal's IDP-classified collateral instruments into the knowledge
 * graph as PII-safe deal -> document edges (predicate deal_has_instrument), so a
 * deal can be traversed to its collateral instrument documents. The instruments
 * are the documents whose extractedData is a real InstrumentRecord (the IDP
 * output). Idempotent: addEdge uses onConflictDoNothing on the kg_edges unique
 * index, so every call safely re-asserts the edge set. Returns the edge count.
 */
export async function indexDealInstrumentEdges(dealId: string): Promise<number> {
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

    const instrumentDocIds = rows
      .filter((r) => isInstrumentRecord(r.extractedData))
      .map((r) => r.id);

    const edges = instrumentEdges(org.id, dealId, instrumentDocIds);
    for (const edge of edges) {
      await addEdge(tx, edge);
    }
    return edges.length;
  });
}
