'use server';

import {
  FixtureChannelAdapter,
  runOutreach,
  type OutreachResult,
} from '@cema/agents-servicer-outreach';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { redactPii } from '@cema/compliance';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { buildOutreachDeps } from './deps';

const tracer = trace.getTracer('@cema/web');

/**
 * Server Action: run one outreach evaluation for a deal in `collateral_chase`,
 * on behalf of the signed-in processor. DORMANT: no UI/cron wires this in M12
 * — it is the live seam, ready behind a trigger once a design partner +
 * RESEND_API_KEY are provisioned. Channel is FixtureChannelAdapter until a real
 * ResendChannelAdapter is wired (a one-line change here, not in the core).
 *
 * Mirrors runIntakeFromLos: request-context concerns (Clerk identity resolution,
 * adapter selection, cache revalidation) live here; the pure orchestrator knows
 * none of them. Span attributes stay PII-safe (CLAUDE.md §10.3): deal ID +
 * boolean outcome only, never email addresses, servicer names, or dollar amounts.
 */
export async function runOutreachFromDeal(dealId: string): Promise<OutreachResult> {
  return tracer.startActiveSpan('outreach.run_from_deal', async (span) => {
    span.setAttribute('outreach.deal_id', dealId);
    try {
      const clerkOrgId = await getCurrentOrganizationId();
      const clerkUser = await getCurrentUser();
      if (!clerkUser) throw new Error('Not authenticated');

      const db = getDb();

      const org = await db.query.organizations.findFirst({
        where: eq(organizations.clerkOrgId, clerkOrgId),
      });
      if (!org) throw new Error('Organization not synced yet');

      const user = await db.query.users.findFirst({
        where: eq(users.clerkUserId, clerkUser.id),
      });
      if (!user) throw new Error('User not synced yet');

      const deps = buildOutreachDeps({
        organizationId: org.id,
        actorUserId: user.id,
        channel: new FixtureChannelAdapter(),
      });

      const result = await runOutreach(dealId, deps);
      span.setAttribute('outreach.action', result.action.kind);
      span.setAttribute('outreach.touch_sent', result.touchSent !== null);

      if (result.touchSent !== null) revalidatePath(`/deals/${dealId}/activity`);

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      // PII-safe: redact the error message before recording in the trace (CLAUDE.md §10.3).
      const safeMessage = redactPii((err as Error).message ?? String(err));
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: safeMessage });
      throw err;
    } finally {
      span.end();
    }
  });
}
