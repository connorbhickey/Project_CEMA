'use server';

import { type IntakeResult } from '@cema/agents-intake';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { start } from 'workflow/api';

import { intakeWorkflow } from './intake.workflow';

/**
 * Durable twin of {@link runIntakeFromLos} (ADR 0013). Identical request-context
 * shell — Clerk identity resolution + cache revalidation — but instead of the
 * in-process `runIntake`, it hands the work to the durable {@link intakeWorkflow}
 * via the WDK runtime, which persists each step's result so a crash-resume
 * replays completed steps from cache rather than re-running them (the deal insert
 * is not duplicated on retry).
 *
 * `start(workflow, args)` enqueues + persists the run and returns a `Run` handle
 * immediately (the args array crosses the durable boundary, so it must be
 * serializable — here three plain strings). `run.returnValue` then polls until
 * the run completes, so this action keeps the same synchronous `Promise<IntakeResult>`
 * contract as the in-process twin even though execution is out-of-process.
 *
 * No manual OTel span here (unlike the in-process action): the durable runtime
 * auto-instruments each workflow + step, and this shell only enqueues then polls,
 * so a wrapping span would be redundant and could not capture the out-of-process
 * step execution anyway.
 *
 * DORMANT: nothing wires this action yet — it is the durable seam, validated by
 * the Neon-gated integration test, not a behavior change. Activating it in
 * production needs a WDK backend + `VERCEL_OIDC_TOKEN` and a `proxy.ts` matcher
 * exclusion for `/.well-known/workflow/*` (all Connor-owned; see ADR 0013).
 */
export async function runIntakeFromLosDurable(externalId: string): Promise<IntakeResult> {
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

  const run = await start(intakeWorkflow, [externalId, org.id, user.id]);
  const result = await run.returnValue;

  // A new intake Deal may now appear on the pipeline.
  if (result.dealId) revalidatePath('/deals');

  return result;
}
