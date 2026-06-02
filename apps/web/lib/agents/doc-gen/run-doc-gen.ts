import { planDocuments } from '@cema/agents-doc-gen';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';

import { withRls } from '../../with-rls';

import { docGenAdapter } from './adapter';
import { loadDocGenInput } from './deal-data';
import { hasExistingPackage, persistGeneratedDocument } from './persist';

const tracer = trace.getTracer('@cema/web-doc-gen');

/**
 * Post-commit Doc-Gen dispatcher (spec §9.7). When a deal enters `doc_prep`, plan
 * the core Refi-CEMA document package, run the numbers-tie consistency check, and
 * (only if consistent) persist each document as a gate-required, enqueued, draft
 * row with its field-map -- behind the dormant DocMagic render seam.
 *
 * Self-resolves identity (mirrors runOutreachFromDeal). Idempotent: skips a deal
 * whose package already exists (anchor cema_3172). Invoked from the best-effort
 * agent dispatcher, which swallows + records `deal.agent_dispatch_failed` on
 * failure, so this may throw and the dispatcher handles it.
 */
export async function runDocGen(dealId: string): Promise<void> {
  return tracer.startActiveSpan('docgen.run', async (span) => {
    span.setAttribute('docgen.deal_id', dealId);
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

      // Idempotency: the package was already generated for this deal.
      if (await hasExistingPackage(org.id, dealId)) {
        span.setAttribute('docgen.skipped', 'already_generated');
        span.setStatus({ code: SpanStatusCode.OK });
        return;
      }

      const input = await loadDocGenInput(org.id, dealId);
      if (!input) {
        span.setAttribute('docgen.skipped', 'missing_data');
        span.setStatus({ code: SpanStatusCode.OK });
        return;
      }

      const plan = planDocuments(input);
      span.setAttribute('docgen.document_count', plan.documents.length);
      span.setAttribute('docgen.consistent', plan.consistency.ok);

      // Split audit (part 1): record the decision BEFORE any write. PII-safe
      // metadata only (count + the boolean / static issue tokens -- never the
      // field-map values).
      await withRls(org.id, (tx) =>
        emitAuditEvent(tx, {
          organizationId: org.id,
          actorUserId: user.id,
          action: 'docgen.evaluated',
          entityType: 'deal',
          entityId: dealId,
          metadata: { count: plan.documents.length, consistent: plan.consistency.ok },
        }),
      );

      if (!plan.consistency.ok) {
        await withRls(org.id, (tx) =>
          emitAuditEvent(tx, {
            organizationId: org.id,
            actorUserId: user.id,
            action: 'docgen.inconsistent',
            entityType: 'deal',
            entityId: dealId,
            metadata: { issues: plan.consistency.issues },
          }),
        );
        span.setStatus({ code: SpanStatusCode.OK });
        return; // numbers do not tie -- generate nothing
      }

      for (const doc of plan.documents) {
        await persistGeneratedDocument(org.id, user.id, dealId, doc);
        await docGenAdapter.render(doc); // dormant (no blob) -- the DocMagic seam
      }

      // Split audit (part 2): record success after the writes.
      await withRls(org.id, (tx) =>
        emitAuditEvent(tx, {
          organizationId: org.id,
          actorUserId: user.id,
          action: 'docgen.generated',
          entityType: 'deal',
          entityId: dealId,
          metadata: { count: plan.documents.length },
        }),
      );
      span.setStatus({ code: SpanStatusCode.OK });
    } finally {
      span.end();
    }
  });
}
