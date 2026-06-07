'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { deals, getDb, organizations, parties, users } from '@cema/db';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { parsePartyRole } from '../deals/party-role';
import { withRls } from '../with-rls';

export interface AddDealPartyInput {
  dealId: string;
  role: string;
  fullName: string;
  email?: string;
  phone?: string;
}

async function resolveIdentity() {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new Error('Not authenticated');
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not synced yet');
  const user = await db.query.users.findFirst({ where: eq(users.clerkUserId, clerkUser.id) });
  if (!user) throw new Error('User not synced yet');
  return { orgId: org.id, userId: user.id };
}

/**
 * Add a party to a deal (the deal-parties editor — closes ADR 0019 Q4: a processor
 * can now add the `seller` a Purchase CEMA needs). The role is validated at the
 * boundary (an untrusted form value); the deal is confirmed in the caller's org
 * before the insert. The audit is PII-safe — role + the new partyId only, never the
 * name/email/phone (hard rule #3); those live solely on the parties row.
 */
export async function addDealParty(input: AddDealPartyInput): Promise<void> {
  const role = parsePartyRole(input.role);
  if (!role) throw new Error('Invalid party role');
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error('Party name is required');
  const email = input.email?.trim() ? input.email.trim() : null;
  const phone = input.phone?.trim() ? input.phone.trim() : null;

  const { orgId, userId } = await resolveIdentity();
  await withRls(orgId, async (tx) => {
    const [deal] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .limit(1);
    if (!deal) throw new Error('Deal not found');

    const [party] = await tx
      .insert(parties)
      .values({ dealId: input.dealId, role, fullName, email, phone })
      .returning({ id: parties.id });

    await emitAuditEvent(tx, {
      organizationId: orgId,
      actorUserId: userId,
      action: 'party.added',
      entityType: 'deal',
      entityId: input.dealId,
      metadata: { partyId: party!.id, role },
    });
  });

  revalidatePath(`/deals/${input.dealId}/parties`);
  revalidatePath(`/deals/${input.dealId}`);
}

export interface UpdateDealPartyInput extends AddDealPartyInput {
  partyId: string;
}

/**
 * Edit an existing party (role / name / email / phone) so a processor can fix it
 * without remove + re-add. Same validation + tenancy as addDealParty; the update is
 * doubly scoped (`id = partyId AND dealId = <the org-verified deal>`) so a cross-org
 * partyId cannot match. PII-safe audit `party.updated` (role + partyId only).
 */
export async function updateDealParty(input: UpdateDealPartyInput): Promise<void> {
  const role = parsePartyRole(input.role);
  if (!role) throw new Error('Invalid party role');
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error('Party name is required');
  const email = input.email?.trim() ? input.email.trim() : null;
  const phone = input.phone?.trim() ? input.phone.trim() : null;

  const { orgId, userId } = await resolveIdentity();
  await withRls(orgId, async (tx) => {
    const [deal] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .limit(1);
    if (!deal) throw new Error('Deal not found');

    const [updated] = await tx
      .update(parties)
      .set({ role, fullName, email, phone })
      .where(and(eq(parties.id, input.partyId), eq(parties.dealId, input.dealId)))
      .returning({ id: parties.id });
    if (!updated) throw new Error('Party not found');

    await emitAuditEvent(tx, {
      organizationId: orgId,
      actorUserId: userId,
      action: 'party.updated',
      entityType: 'deal',
      entityId: input.dealId,
      metadata: { partyId: updated.id, role },
    });
  });

  revalidatePath(`/deals/${input.dealId}/parties`);
  revalidatePath(`/deals/${input.dealId}`);
}

/**
 * Remove a party from a deal. The delete is doubly scoped — `id = partyId AND
 * dealId = <the org-verified deal>` — so a partyId from another org cannot match
 * (its dealId differs). A no-op (already gone / wrong org) writes no audit.
 */
export async function removeDealParty(input: { dealId: string; partyId: string }): Promise<void> {
  const { orgId, userId } = await resolveIdentity();
  await withRls(orgId, async (tx) => {
    const [deal] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .limit(1);
    if (!deal) throw new Error('Deal not found');

    const [removed] = await tx
      .delete(parties)
      .where(and(eq(parties.id, input.partyId), eq(parties.dealId, input.dealId)))
      .returning({ id: parties.id, role: parties.role });
    if (!removed) return;

    await emitAuditEvent(tx, {
      organizationId: orgId,
      actorUserId: userId,
      action: 'party.removed',
      entityType: 'deal',
      entityId: input.dealId,
      metadata: { partyId: removed.id, role: removed.role },
    });
  });

  revalidatePath(`/deals/${input.dealId}/parties`);
  revalidatePath(`/deals/${input.dealId}`);
}
