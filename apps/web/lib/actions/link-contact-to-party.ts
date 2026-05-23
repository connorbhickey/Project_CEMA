'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { deals, getDb, parties } from '@cema/db';
import { addEdge } from '@cema/kg';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export interface LinkContactToPartyResult {
  edgesCreated: number;
  contactId: string;
  partyId: string;
  dealId: string;
}

export async function linkContactToParty(
  contactId: string,
  partyId: string,
): Promise<LinkContactToPartyResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new Error('User not authenticated');

  const db = getDb();
  const [org, user] = await Promise.all([
    db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId) }),
    db.query.users.findFirst({ where: (u, { eq }) => eq(u.clerkUserId, clerkUser.id) }),
  ]);
  if (!org) throw new Error('Organization not found');
  if (!user) throw new Error('User not found');

  return withRls(org.id, async (tx) => {
    const [partyRow] = await tx
      .select({ id: parties.id, dealId: parties.dealId })
      .from(parties)
      .innerJoin(deals, eq(deals.id, parties.dealId))
      .where(and(eq(parties.id, partyId), eq(deals.organizationId, org.id)));

    if (!partyRow) throw new Error('Party not found');

    await Promise.all([
      addEdge(tx as never, {
        organizationId: org.id,
        subjectId: contactId,
        subjectType: 'contact',
        predicate: 'contact_is_party',
        objectId: partyRow.id,
        objectType: 'party',
      }),
      addEdge(tx as never, {
        organizationId: org.id,
        subjectId: partyRow.id,
        subjectType: 'party',
        predicate: 'party_is_on_deal',
        objectId: partyRow.dealId,
        objectType: 'deal',
      }),
    ]);

    return { edgesCreated: 2, contactId, partyId: partyRow.id, dealId: partyRow.dealId };
  });
}
