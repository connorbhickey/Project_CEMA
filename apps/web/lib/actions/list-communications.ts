import { getCurrentOrganizationId } from '@cema/auth';
import { communications, getDb, organizations } from '@cema/db';
import { and, desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Communication = typeof communications.$inferSelect;

export async function listCommunications(dealId: string): Promise<Communication[] | null> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return null;

  return withRls(org.id, async (tx) =>
    tx
      .select()
      .from(communications)
      .where(and(eq(communications.dealId, dealId), eq(communications.organizationId, org.id)))
      .orderBy(desc(communications.createdAt)),
  );
}
