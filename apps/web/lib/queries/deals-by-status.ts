import { getCurrentOrganizationId } from '@cema/auth';
import { deals, getDb, organizations } from '@cema/db';
import { eq, sql } from 'drizzle-orm';

import { type DealStatusCount } from '../dashboard/pipeline-summary';
import { withRls } from '../with-rls';

/**
 * RLS-scoped: count deals grouped by status for the current org (all-time).
 * deals carries org RLS, and we also filter explicitly by org id (mirrors
 * getOrgExceptions). Returns [] if the org is unresolved.
 */
export async function getDealsByStatus(): Promise<DealStatusCount[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({ status: deals.status, count: sql<number>`count(*)::int` })
      .from(deals)
      .where(eq(deals.organizationId, org.id))
      .groupBy(deals.status);
    return rows.map((r) => ({ status: r.status, count: r.count }));
  });
}
