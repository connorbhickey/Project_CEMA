import { getCurrentOrganizationId } from '@cema/auth';
import { contactIdentities, contacts, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withReadAudit } from '../audit/with-read-audit';
import { withRls } from '../with-rls';

type Contact = typeof contacts.$inferSelect;
type ContactIdentity = typeof contactIdentities.$inferSelect;

export interface ContactDetailResult {
  contact: Contact;
  identities: ContactIdentity[];
}

export async function getContact(contactId: string): Promise<ContactDetailResult | null> {
  return withReadAudit(
    { entityType: 'contact', entityId: contactId, purpose: 'view_detail' },
    async () => {
      const clerkOrgId = await getCurrentOrganizationId();
      const db = getDb();
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.clerkOrgId, clerkOrgId),
      });
      if (!org) return null;

      return withRls(org.id, async (tx) => {
        const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
        if (!c) return null;
        const idents = await tx
          .select()
          .from(contactIdentities)
          .where(eq(contactIdentities.contactId, c.id));
        return { contact: c, identities: idents };
      });
    },
  );
}
