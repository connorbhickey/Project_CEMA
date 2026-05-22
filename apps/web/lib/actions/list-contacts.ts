import { getCurrentOrganizationId } from '@cema/auth';
import { contactIdentities, contacts, getDb, organizations } from '@cema/db';
import { desc, eq, sql } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Contact = typeof contacts.$inferSelect;

export interface ContactListRow {
  contact: Contact;
  identityCount: number;
}

export async function listContacts(): Promise<ContactListRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({
        contact: contacts,
        identityCount: sql<number>`count(${contactIdentities.id})::int`,
      })
      .from(contacts)
      .leftJoin(contactIdentities, eq(contactIdentities.contactId, contacts.id))
      .groupBy(contacts.id)
      .orderBy(desc(contacts.createdAt));
    return rows;
  });
}
