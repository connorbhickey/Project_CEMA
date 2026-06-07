'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { deals, existingLoans, getDb, newLoans, organizations, properties, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { notifyInternalDealCreated } from '../agents/internal-comms/notify-internal';
import { withRls } from '../with-rls';

import { createDealInputSchema } from './create-deal-schema';

export type { CreateDealInput } from './create-deal-schema';

export async function createDeal(rawInput: unknown): Promise<{ id: string }> {
  const input = createDealInputSchema.parse(rawInput);
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new Error('Not authenticated');

  const db = getDb();

  // Resolve internal org and user ids from Clerk IDs
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not synced yet');

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!user) throw new Error('User not synced yet');

  const created = await withRls(org.id, async (tx) => {
    const [property] = await tx
      .insert(properties)
      .values({
        streetAddress: input.streetAddress,
        unit: input.unit,
        city: input.city,
        county: input.county,
        zipCode: input.zipCode,
        propertyType: input.propertyType,
      })
      .returning();

    const [newLoan] = await tx
      .insert(newLoans)
      .values({
        organizationId: org.id, // Task 7 fix-up: newLoans is org-scoped
        principal: input.principal,
        program: input.program,
      })
      .returning();

    const [deal] = await tx
      .insert(deals)
      .values({
        organizationId: org.id,
        cemaType: input.cemaType,
        propertyId: property!.id,
        newLoanId: newLoan!.id,
        createdById: user.id,
      })
      .returning();

    await tx.insert(existingLoans).values({
      dealId: deal!.id,
      upb: input.upb,
      chainPosition: 0,
    });

    await emitAuditEvent(tx, {
      organizationId: org.id,
      actorUserId: user.id,
      action: 'deal.created',
      entityType: 'deal',
      entityId: deal!.id,
      // PII-safe (hard rule #3): enum token only. principal/upb are dollar figures
      // (UPB is a payoff-adjacent amount the rule lists) and must NOT enter the
      // audit log — every other agent's audit metadata is token/id-only.
      metadata: { cemaType: input.cemaType },
    });

    return { id: deal!.id };
  });

  // Post-commit, BEST-EFFORT: announce the new deal on the org's internal pipeline
  // channel so the loan officer / team see it enter the funnel (ADR 0010 #8). Never
  // throws — a failed announcement must not surface on the committed deal creation.
  await notifyInternalDealCreated(created.id, {
    organizationId: org.id,
    actorUserId: user.id,
  });

  revalidatePath('/deals');
  return created;
}
