'use server';

import { runChainOfTitle } from '@cema/agents-chain-of-title';
import type { ChainResult } from '@cema/agents-chain-of-title';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { redactPii } from '@cema/compliance';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';

import { buildChainDeps } from './deps';

const tracer = trace.getTracer('@cema/web-chain-of-title');

/**
 * Server Action entry to the Chain-of-Title core. Resolves the Clerk org +
 * user, builds the real DB-backed deps, and runs the analyzer for one deal.
 * Errors are PII-redacted before they leave the boundary. No revalidatePath
 * here: this analyzer run is triggered by the collateral pipeline, not a user
 * navigation; the deal review surface (/deals/[id]/documents) recomputes the
 * chain live and the Tier 2 transition action revalidates after a claim/resolve.
 */
export async function runChainOfTitleFromDeal(dealId: string): Promise<ChainResult> {
  return tracer.startActiveSpan('chain.run_from_deal', async (span) => {
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

      const deps = buildChainDeps({ organizationId: org.id, actorUserId: user.id });
      const result = await runChainOfTitle(dealId, deps);

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
