import { normalizeEmail, normalizePhone } from '@cema/contacts';
import { contactIdentities, contacts } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { findNeighbors } from './edges';
import type { DbOrTx } from './types';

export interface ResolveInput {
  organizationId: string;
  email?: string;
  phone?: string;
}

export interface ResolveResult {
  contactId: string;
  partyId: string | null;
  dealId: string | null;
}

/**
 * Given a sender email or phone, resolves the contact → party → deal chain
 * through the knowledge graph.
 *
 * Returns null when no matching contact_identity exists for the org.
 * Returns { contactId, partyId: null, dealId: null } when a contact exists
 * but has no 'contact_is_party' edge in the KG yet.
 */
export async function resolvePartyFromContact(
  tx: DbOrTx,
  input: ResolveInput,
): Promise<ResolveResult | null> {
  if (!input.email && !input.phone) return null;

  const normalizedEmail = input.email ? normalizeEmail(input.email) : null;
  const normalizedPhone = input.phone ? normalizePhone(input.phone) : null;
  const normalizedValue = normalizedEmail ?? normalizedPhone;
  if (!normalizedValue) return null;

  // 1. Find a matching contact identity in this org.
  const identityRows = await tx
    .select({ contactId: contactIdentities.contactId })
    .from(contactIdentities)
    .innerJoin(contacts, eq(contactIdentities.contactId, contacts.id))
    .where(
      and(
        eq(contactIdentities.organizationId, input.organizationId),
        eq(contactIdentities.normalizedValue, normalizedValue),
      ),
    );

  if (!identityRows.length || !identityRows[0]) return null;

  const { contactId } = identityRows[0];

  // 2. Find the contact → party edge in the KG.
  const partyNeighbors = await findNeighbors(tx, {
    organizationId: input.organizationId,
    nodeId: contactId,
    nodeType: 'contact',
    predicate: 'contact_is_party',
  });

  if (!partyNeighbors.length || !partyNeighbors[0]) {
    return { contactId, partyId: null, dealId: null };
  }

  const partyId = partyNeighbors[0].nodeId;

  // 3. Follow the party → deal edge.
  const dealNeighbors = await findNeighbors(tx, {
    organizationId: input.organizationId,
    nodeId: partyId,
    nodeType: 'party',
    predicate: 'party_is_on_deal',
  });

  const dealId = dealNeighbors[0]?.nodeId ?? null;

  return { contactId, partyId, dealId };
}
