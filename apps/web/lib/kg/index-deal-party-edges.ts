import { getCurrentOrganizationId } from '@cema/auth';
import { getDb, organizations, parties } from '@cema/db';
import { addEdge } from '@cema/kg';
import { eq } from 'drizzle-orm';

import { partyEdges } from './party-edges';

import { withRls } from '@/lib/with-rls';

/**
 * Indexes ALL of a deal's parties (the parties table) into the knowledge graph
 * as PII-safe `party -> deal` edges (predicate party_is_on_deal), so a deal is
 * traversable to its parties (and vice versa) regardless of how each party was
 * created. Complements the contact-link-time edge in linkContactToParty, which
 * only covers explicitly linked contacts -- borrower / co_borrower / servicer
 * parties set at deal creation were previously absent from the graph. Idempotent:
 * addEdge uses onConflictDoNothing on the kg_edges unique index. Returns the
 * edge count.
 */
export async function indexDealPartyEdges(dealId: string): Promise<number> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return 0;

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(eq(parties.dealId, dealId));
    const edges = partyEdges(
      org.id,
      dealId,
      rows.map((r) => r.id),
    );
    for (const edge of edges) {
      await addEdge(tx, edge);
    }
    return edges.length;
  });
}
