'use server';

import { FixtureLosAdapter, runIntake, type IntakeResult } from '@cema/agents-intake';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { buildIntakeDeps } from './deps';

/**
 * Server Action: run the Intake Agent for one LOS application id, on behalf of
 * the signed-in processor (actor model: human-triggered — a processor imports an
 * application; spec §9.3). This shell owns the request-context concerns the core
 * deliberately avoids — Clerk identity resolution, adapter selection, and cache
 * revalidation — then delegates to the pure orchestrator.
 *
 * The LOS surface is the FixtureLosAdapter until a real LOS adapter (Encompass
 * etc.) is wired; swapping it is a one-line change here, not in the core.
 */
export async function runIntakeFromLos(externalId: string): Promise<IntakeResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new Error('Not authenticated');

  const db = getDb();

  // Resolve internal org + user ids from Clerk ids (mirrors createDeal).
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not synced yet');

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!user) throw new Error('User not synced yet');

  const deps = buildIntakeDeps({
    organizationId: org.id,
    actorUserId: user.id,
    adapter: new FixtureLosAdapter(),
  });

  const result = await runIntake(externalId, deps);

  // A new intake Deal may now appear on the pipeline.
  if (result.dealId) revalidatePath('/deals');

  return result;
}
