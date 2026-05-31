'use server';

import { runChainOfTitle } from '@cema/agents-chain-of-title';
import type { ChainResult } from '@cema/agents-chain-of-title';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { redactPii } from '@cema/compliance';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { start } from 'workflow/api';

import { chainWorkflow } from './chain.workflow';

const tracer = trace.getTracer('@cema/web-chain-of-title');

/**
 * DORMANT durable variant of runChainOfTitleFromDeal: starts chainWorkflow and
 * awaits run.returnValue to preserve the synchronous Promise<ChainResult>
 * contract. Single-pass + bounded, so unlike the M12 outreach cadence the
 * in-request await is acceptable here (no weeks-long sleep).
 *
 * Activation prerequisites (Connor-owned): provision a WDK backend +
 * VERCEL_OIDC_TOKEN, exclude /.well-known/workflow/* from the proxy.ts matcher
 * (ADR 0013 Decision 4), then flip a trigger behind a flag. Until then
 * runChainOfTitleFromDeal (the in-request Server Action) is the only live path.
 */
export async function runChainOfTitleFromDealDurable(dealId: string): Promise<ChainResult> {
  return tracer.startActiveSpan('chain.run_from_deal_durable', async (span) => {
    span.setAttribute('chain.deal_id', dealId);
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

      const run = await start(chainWorkflow, [dealId, org.id, user.id]);
      const result = await run.returnValue;

      span.setAttribute('chain.status', result.status);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = redactPii((err as Error).message);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw new Error(message);
    } finally {
      span.end();
    }
  });
}

// Re-exported so the dormant action keeps a value-level reference to the core
// (parity with the IDP dormant action; avoids an unused-import lint on swap-in).
export { runChainOfTitle };
