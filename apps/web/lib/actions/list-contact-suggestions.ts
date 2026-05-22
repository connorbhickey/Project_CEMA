import { getCurrentOrganizationId } from '@cema/auth';
import { normalizeEmail, normalizePhone } from '@cema/contacts';
import { contactIdentities, contacts, getDb, organizations } from '@cema/db';
import { and, eq, inArray } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Contact = typeof contacts.$inferSelect;

export interface SuggestionInput {
  emails?: (string | null | undefined)[];
  phones?: (string | null | undefined)[];
}

export async function listContactSuggestions(input: SuggestionInput): Promise<Contact[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const normalizedEmails = (input.emails ?? [])
    .map((v) => normalizeEmail(v))
    .filter((v): v is string => v !== null);
  const normalizedPhones = (input.phones ?? [])
    .map((v) => normalizePhone(v))
    .filter((v): v is string => v !== null);

  if (normalizedEmails.length === 0 && normalizedPhones.length === 0) return [];

  return withRls(org.id, async (tx) => {
    const matches = await tx
      .select({ contactId: contactIdentities.contactId })
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.organizationId, org.id),
          inArray(contactIdentities.normalizedValue, [...normalizedEmails, ...normalizedPhones]),
        ),
      );

    const ids = Array.from(new Set(matches.map((m) => m.contactId)));
    if (ids.length === 0) return [];

    return tx.select().from(contacts).where(inArray(contacts.id, ids));
  });
}
