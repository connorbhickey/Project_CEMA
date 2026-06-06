import { getCurrentOrganizationId } from '@cema/auth';
import { deals, getDb, organizations, parties } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '@/lib/with-rls';

export interface DealParty {
  readonly id: string;
  readonly role: string;
  readonly fullName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
}

/**
 * RLS-scoped read of a deal's parties (id / role / contact fields), ordered by
 * role. Tenancy: the deal is confirmed in the caller's org (deals RLS) before its
 * parties are read, so a cross-org dealId returns []. fullName/email/phone are PII
 * — rendered in the authenticated workspace, never logged or audited.
 */
export async function getDealParties(dealId: string): Promise<DealParty[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const [deal] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(eq(deals.id, dealId))
      .limit(1);
    if (!deal) return [];

    return tx
      .select({
        id: parties.id,
        role: parties.role,
        fullName: parties.fullName,
        email: parties.email,
        phone: parties.phone,
      })
      .from(parties)
      .where(eq(parties.dealId, dealId))
      .orderBy(parties.role);
  });
}
