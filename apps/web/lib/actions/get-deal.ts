import { getCurrentOrganizationId } from '@cema/auth';
import { deals, existingLoans, getDb, newLoans, organizations, properties } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '@/lib/with-rls';

type Deal = typeof deals.$inferSelect;
type Property = typeof properties.$inferSelect;
type NewLoan = typeof newLoans.$inferSelect;
type ExistingLoan = typeof existingLoans.$inferSelect;

export type DealDetail = {
  deal: Deal;
  property: Property | null;
  newLoan: NewLoan | null;
  existingLoans: ExistingLoan[];
};

export async function getDeal(id: string): Promise<DealDetail | null> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return null;
  return withRls(org.id, async (tx) => {
    const deal = await tx.query.deals.findFirst({
      where: and(eq(deals.id, id), eq(deals.organizationId, org.id)),
    });
    if (!deal) return null;
    const property = deal.propertyId
      ? await tx.query.properties.findFirst({ where: eq(properties.id, deal.propertyId) })
      : null;
    const newLoan = deal.newLoanId
      ? await tx.query.newLoans.findFirst({ where: eq(newLoans.id, deal.newLoanId) })
      : null;
    const existing = await tx.query.existingLoans.findMany({
      where: eq(existingLoans.dealId, deal.id),
    });
    return {
      deal,
      property: property ?? null,
      newLoan: newLoan ?? null,
      existingLoans: existing,
    };
  });
}
