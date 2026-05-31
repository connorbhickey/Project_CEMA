'use server';

import type { IdpResult } from '@cema/agents-collateral-idp';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { start } from 'workflow/api';

import { idpWorkflow } from './idp.workflow';

const tracer = trace.getTracer('@cema/web');

/**
 * Durable variant of runCollateralIdpFromDeal: starts idpWorkflow and awaits
 * run.returnValue to preserve the synchronous Promise<IdpResult> contract.
 *
 * DORMANT: nothing wires this in M13. Activation prerequisites (Connor-owned):
 * provision a WDK backend + VERCEL_OIDC_TOKEN, exclude /.well-known/workflow/*
 * from the proxy.ts matcher (ADR 0013 Decision 4), then flip a trigger to
 * route collateral-file-ready deals through here behind a flag. (Single-pass,
 * so unlike M12 there is no in-request-vs-fire-and-forget contract concern.)
 */
export async function runCollateralIdpFromDealDurable(dealId: string): Promise<IdpResult> {
  return tracer.startActiveSpan('idp.run_from_deal_durable', async (span) => {
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

      const run = await start(idpWorkflow, [dealId, org.id, user.id]);
      const result = await run.returnValue;

      span.setAttribute('idp.document_count', result.documents.length);
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
