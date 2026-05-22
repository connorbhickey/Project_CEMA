'use server';

import { getCurrentOrganizationId } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { contactIdentities, contacts, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export interface MergeContactsResult {
  movedIdentities: number;
  loserContactId: string;
  winnerContactId: string;
}

export async function mergeContacts(
  winnerContactId: string,
  loserContactId: string,
): Promise<MergeContactsResult> {
  if (winnerContactId === loserContactId) {
    throw new Error('Cannot merge a contact into itself');
  }

  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');

  let movedIdentities = 0;

  await withRls(org.id, async (tx) => {
    const [winner] = await tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, winnerContactId))
      .limit(1);
    const [loser] = await tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, loserContactId))
      .limit(1);
    if (!winner || !loser) throw new Error('Contact not found');

    const result = await tx
      .update(contactIdentities)
      .set({ contactId: winnerContactId, updatedAt: new Date() })
      .where(eq(contactIdentities.contactId, loserContactId));
    movedIdentities = (result as unknown as { rowCount?: number }).rowCount ?? 0;

    await tx.delete(contacts).where(eq(contacts.id, loserContactId));
  });

  await emitAuditEvent(db, {
    organizationId: org.id,
    action: 'contact.merged',
    entityType: 'contact',
    entityId: winnerContactId,
    metadata: { loserContactId, movedIdentities },
  });

  return { movedIdentities, loserContactId, winnerContactId };
}
