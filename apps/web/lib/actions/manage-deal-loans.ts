'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { deals, existingLoans, getDb, organizations, users } from '@cema/db';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { parseExistingLoanInput, type ExistingLoanFormInput } from '../deals/existing-loan-input';
import { withRls } from '../with-rls';

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
 * Add an existing (prior) loan to a deal's consolidation chain — the Schedule A
 * the CEMA consolidates. Input is validated/normalized by parseExistingLoanInput
 * (UPB / chain-position / recording-XOR invariants); the deal is confirmed in-org
 * and the chain position is checked for uniqueness within the deal (the
 * `existing_loans_deal_chain_pos_idx` unique index) before the insert. The audit is
 * PII-safe — loanId + chainPosition only, never the UPB/payoff figures (hard rule #3).
 */
export async function addExistingLoan(dealId: string, raw: ExistingLoanFormInput): Promise<void> {
  const loan = parseExistingLoanInput(raw);
  const { orgId, userId } = await resolveIdentity();

  await withRls(orgId, async (tx) => {
    const [deal] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(eq(deals.id, dealId))
      .limit(1);
    if (!deal) throw new Error('Deal not found');

    const [clash] = await tx
      .select({ id: existingLoans.id })
      .from(existingLoans)
      .where(
        and(eq(existingLoans.dealId, dealId), eq(existingLoans.chainPosition, loan.chainPosition)),
      )
      .limit(1);
    if (clash) {
      throw new Error(`Chain position ${loan.chainPosition} is already used on this deal`);
    }

    const [inserted] = await tx
      .insert(existingLoans)
      .values({
        dealId,
        upb: loan.upb,
        chainPosition: loan.chainPosition,
        originalPrincipal: loan.originalPrincipal,
        investor: loan.investor,
        recordedReelPage: loan.recordedReelPage,
        recordedCrfn: loan.recordedCrfn,
      })
      .returning({ id: existingLoans.id });

    await emitAuditEvent(tx, {
      organizationId: orgId,
      actorUserId: userId,
      action: 'loan.added',
      entityType: 'deal',
      entityId: dealId,
      metadata: { loanId: inserted!.id, chainPosition: loan.chainPosition },
    });
  });

  revalidatePath(`/deals/${dealId}/loans`);
  revalidatePath(`/deals/${dealId}`);
}

/**
 * Remove an existing loan from a deal's chain. Doubly scoped (`id AND dealId`,
 * with the deal confirmed in-org) so a cross-org loanId cannot match. A no-op
 * (already gone / wrong org) writes no audit.
 */
export async function removeExistingLoan(input: { dealId: string; loanId: string }): Promise<void> {
  const { orgId, userId } = await resolveIdentity();

  await withRls(orgId, async (tx) => {
    const [deal] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .limit(1);
    if (!deal) throw new Error('Deal not found');

    const [removed] = await tx
      .delete(existingLoans)
      .where(and(eq(existingLoans.id, input.loanId), eq(existingLoans.dealId, input.dealId)))
      .returning({ id: existingLoans.id, chainPosition: existingLoans.chainPosition });
    if (!removed) return;

    await emitAuditEvent(tx, {
      organizationId: orgId,
      actorUserId: userId,
      action: 'loan.removed',
      entityType: 'deal',
      entityId: input.dealId,
      metadata: { loanId: removed.id, chainPosition: removed.chainPosition },
    });
  });

  revalidatePath(`/deals/${input.dealId}/loans`);
  revalidatePath(`/deals/${input.dealId}`);
}
