'use server';

import type { IdpResult } from '@cema/agents-collateral-idp';
import { FixtureIdpAdapter, runCollateralIdp } from '@cema/agents-collateral-idp';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { redactPii } from '@cema/compliance';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { buildIdpDeps } from './deps';

const tracer = trace.getTracer('@cema/web');

/**
 * Live (non-durable) Collateral IDP entry point. Resolves the Clerk org/user,
 * builds IdpDeps with the FixtureIdpAdapter (real vendor adapter is ADR
 * carry-over #1), runs the pure core, and revalidates the deal's documents
 * page when anything was enriched.
 */
export async function runCollateralIdpFromDeal(dealId: string): Promise<IdpResult> {
  return tracer.startActiveSpan('idp.run_from_deal', async (span) => {
    span.setAttribute('idp.deal_id', dealId);
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

      const deps = buildIdpDeps({
        organizationId: org.id,
        actorUserId: user.id,
        idp: new FixtureIdpAdapter(),
      });
      const result = await runCollateralIdp(dealId, deps);

      if (result.documents.length > 0) {
        revalidatePath(`/deals/${dealId}/documents`);
      }

      span.setAttribute('idp.document_count', result.documents.length);
      span.setAttribute('idp.unreadable_count', result.unreadable.length);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: redactPii((err as Error).message) });
      throw err;
    } finally {
      span.end();
    }
  });
}
