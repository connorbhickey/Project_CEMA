import { getCurrentOrganizationId } from '@cema/auth';
import { deals, getDb, organizations, properties } from '@cema/db';
import { and, desc, eq } from 'drizzle-orm';

import { type DealStatus } from '@/lib/deals/deal-status';
import { withRls } from '@/lib/with-rls';

export type Deal = typeof deals.$inferSelect;

export interface DealRow {
  id: string;
  cemaType: Deal['cemaType'];
  status: Deal['status'];
  createdAt: Date;
  streetAddress: string | null;
  city: string | null;
}

export async function listDeals(status?: DealStatus): Promise<DealRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const conditions = [eq(deals.organizationId, org.id)];
    if (status) conditions.push(eq(deals.status, status));

    return tx
      .select({
        id: deals.id,
        cemaType: deals.cemaType,
        status: deals.status,
        createdAt: deals.createdAt,
        streetAddress: properties.streetAddress,
        city: properties.city,
      })
      .from(deals)
      .leftJoin(properties, eq(deals.propertyId, properties.id))
      .where(and(...conditions))
      .orderBy(desc(deals.createdAt))
      .limit(50);
  });
}
