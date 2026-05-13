import { getCurrentOrganizationId } from '@cema/auth';
import { deals, getDb, organizations } from '@cema/db';
import { desc, eq } from 'drizzle-orm';

import { withRls } from '@/lib/with-rls';

export async function listDeals() {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];
  return withRls(org.id, async (tx) =>
    tx.query.deals.findMany({
      where: eq(deals.organizationId, org.id),
      orderBy: [desc(deals.createdAt)],
      limit: 50,
    }),
  );
}
