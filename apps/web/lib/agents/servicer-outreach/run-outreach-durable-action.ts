'use server';

import type { OutreachResult } from '@cema/agents-servicer-outreach';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { start } from 'workflow/api';

import { outreachWorkflow } from './outreach.workflow';


const tracer = trace.getTracer('@cema/web');

/**
 * Durable variant of `runOutreachFromDeal`: starts `outreachWorkflow` and awaits
 * `run.returnValue` to preserve the same synchronous `Promise<OutreachResult>`
 * contract callers expect (ADR 0013 Decision 3). Duplicates the Clerk org/user
 * resolution from `run-outreach-action.ts` rather than refactoring -- the live
 * (non-durable) action must not be regressed, and a shared extraction is out of
 * scope for a dormant seam.
 *
 * DORMANT: nothing wires this in M12. Activation prerequisites (Connor-owned):
 * provision a WDK backend + VERCEL_OIDC_TOKEN, exclude /.well-known/workflow/*
 * from the proxy.ts matcher (ADR 0013 Decision 4), then flip a trigger to route
 * `collateral_chase` deals through here behind a flag.
 */
export async function runOutreachFromDealDurable(dealId: string): Promise<OutreachResult> {
  return tracer.startActiveSpan('outreach.run_from_deal_durable', async (span) => {
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

      const run = await start(outreachWorkflow, [dealId, org.id, user.id]);
      const result = (await run.returnValue);

      span.setAttribute('outreach.action', result.action.kind);
      span.setAttribute('outreach.touch_sent', result.touchSent !== null);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
