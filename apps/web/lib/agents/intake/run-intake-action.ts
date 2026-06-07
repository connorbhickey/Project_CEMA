'use server';

import { FixtureLosAdapter, runIntake, type IntakeResult } from '@cema/agents-intake';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { buildIntakeDeps } from './deps';
import { draftAndStoreSavingsNarrative } from './narrative';

const tracer = trace.getTracer('@cema/web');

/**
 * Server Action: run the Intake Agent for one LOS application id, on behalf of
 * the signed-in processor (actor model: human-triggered — a processor imports an
 * application; spec §9.3). This shell owns the request-context concerns the core
 * deliberately avoids — Clerk identity resolution, adapter selection, and cache
 * revalidation — then delegates to the pure orchestrator.
 *
 * The whole action runs inside an `intake.run_from_los` span (ADR 0011); the
 * orchestrator's own spans nest beneath it via context propagation, so a single
 * trace covers identity resolution → eligibility → audit → deal creation. Span
 * attributes stay PII-safe (CLAUDE.md §10.3): ids and the boolean outcome only.
 *
 * The LOS surface is the FixtureLosAdapter until a real LOS adapter (Encompass
 * etc.) is wired; swapping it is a one-line change here, not in the core.
 */
export async function runIntakeFromLos(externalId: string): Promise<IntakeResult> {
  return tracer.startActiveSpan('intake.run_from_los', async (span) => {
    span.setAttribute('intake.external_id', externalId);
    try {
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

      const adapter = new FixtureLosAdapter();
      const deps = buildIntakeDeps({
        organizationId: org.id,
        actorUserId: user.id,
        adapter,
      });

      const result = await runIntake(externalId, deps);
      span.setAttribute('intake.eligible', result.eligibility.eligible);
      span.setAttribute('intake.deal_created', result.dealId !== null);
      if (result.dealId) span.setAttribute('intake.deal_id', result.dealId);

      // Best-effort borrower-facing savings narrative (the agent's only LLM
      // surface) — runs AFTER the deterministic Deal is created + complete, so a
      // configured-but-failed model call is swallowed (Sentry) rather than failing
      // the intake (ADR 0010 #7). Re-reads the application via the adapter (the
      // pure result intentionally omits it). Never throws; null when the LLM is off.
      if (result.dealId && result.savings) {
        const application = await adapter.getApplication(externalId);
        const drafted = await draftAndStoreSavingsNarrative({
          dealId: result.dealId,
          organizationId: org.id,
          application,
          savings: result.savings,
          generatedAt: new Date().toISOString(),
        });
        span.setAttribute('intake.narrative_drafted', drafted);
      }

      // A new intake Deal may now appear on the pipeline.
      if (result.dealId) revalidatePath('/deals');

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
