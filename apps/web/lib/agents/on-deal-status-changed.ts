import { emitAuditEvent, redactPii } from '@cema/compliance';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import type { DealStatus } from '../actions/transition-deal-status';
import { ERROR_IDS } from '../constants/error-ids';
import { withRls } from '../with-rls';

import { runCollateralPipeline } from './collateral-pipeline';
import { runDocGen } from './doc-gen/run-doc-gen';
import { triggerForStatus } from './on-deal-status-changed-core';
import { runOutreachFromDeal } from './servicer-outreach/run-outreach-action';

const tracer = trace.getTracer('@cema/web-deal-status-dispatch');

/**
 * Tenancy + actor context for the dispatch-failure audit. The caller
 * (transitionDealStatus) has already resolved the Clerk org + user for the
 * status write, so we thread them in rather than re-resolving (the agent actions
 * re-resolve identity themselves; only the audit needs this).
 */
export interface DealStatusDispatchContext {
  organizationId: string;
  actorUserId: string;
}

/**
 * Post-commit agent dispatcher. Called AFTER a deal-status change has committed
 * and been audited, it fires the Layer-3 agent wired to the new status (if any).
 *
 * BEST-EFFORT by design: a failed agent run must never roll back or surface on
 * the status change itself, so every error is swallowed and logged PII-safe.
 * The status write already succeeded; the agent run is a downstream side effect.
 *
 * On failure we ALSO record a durable, PII-safe `deal.agent_dispatch_failed`
 * audit so the failure is queryable — since Tier 2 (ADR 0018) a failed
 * `collateral_pipeline` dispatch can mean attorney-review chain breaks were
 * detected but not enqueued, which would otherwise be invisible (a processor
 * could not tell "no breaks" from "enqueue silently failed"). It self-heals on
 * the next `title_work` transition (the enqueue is idempotent), but the audit
 * makes the gap durable and alertable. The audit is itself best-effort: the same
 * outage that failed the agent can fail the insert, and that must not escape.
 *
 * Today the agent actions are session-backed Server Actions, so this runs
 * IN-REQUEST (the only trigger path that works without a durable backend or a
 * request session — cron/queue have neither). At durable activation this should
 * become fire-and-forget (enqueue, return immediately).
 */
export async function onDealStatusChanged(
  dealId: string,
  toStatus: DealStatus,
  ctx: DealStatusDispatchContext,
): Promise<void> {
  const trigger = triggerForStatus(toStatus);
  if (!trigger) return;

  return tracer.startActiveSpan('deal.status_dispatch', async (span) => {
    // PII-safe attributes only: opaque dealId, the deal_status enum value, and
    // the trigger token (hard rule #3).
    span.setAttribute('dispatch.deal_id', dealId);
    span.setAttribute('dispatch.to_status', toStatus);
    span.setAttribute('dispatch.agent', trigger);
    try {
      if (trigger === 'collateral_pipeline') {
        await runCollateralPipeline(dealId);
      } else if (trigger === 'doc_gen') {
        await runDocGen(dealId);
      } else {
        await runOutreachFromDeal(dealId);
      }
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      // The agent actions redact at their own boundary; redact again here as
      // defense in depth (redactPii is idempotent).
      const message = redactPii(err instanceof Error ? err.message : String(err));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      // PII-safe AND log-injection-safe: redact the WHOLE emitted line (hard
      // rule #3, not just the exception message) and strip every CR/LF so an
      // untrusted dealId can never forge a second log entry. The redact+replace
      // MUST stay INLINE in the direct dataflow to console.error: the
      // quantifier-free /[\r\n]/g is the form CodeQL recognizes as a
      // js/log-injection sanitizer, and it stops recognizing it once it is
      // hidden behind a helper. The ERROR_IDS token makes the line greppable
      // (and is the seam a future Sentry router keys on).
      // eslint-disable-next-line no-console
      console.error(
        redactPii(
          `[${ERROR_IDS.AGENT_DISPATCH_FAILED}] ${trigger} failed for deal ${dealId}: ${message}`,
        ).replace(/[\r\n]/g, ' '),
      );

      // Durable, queryable failure record. Metadata is PII-safe by construction:
      // the deal_status enum + the internal trigger token only — never the
      // (already-redacted) error message, party names, or amounts. Best-effort:
      // a failing audit insert (e.g. the same DB outage) must not escape the
      // dispatcher and undo the already-committed status write.
      try {
        await withRls(ctx.organizationId, (tx) =>
          emitAuditEvent(tx, {
            organizationId: ctx.organizationId,
            actorUserId: ctx.actorUserId,
            action: 'deal.agent_dispatch_failed',
            entityType: 'deal',
            entityId: dealId,
            metadata: { status: toStatus, trigger },
          }),
        );
      } catch (auditErr) {
        const auditMessage = auditErr instanceof Error ? auditErr.message : String(auditErr);
        // Same inline redact + CR/LF strip (see note above) — keep the sanitizer
        // in the direct dataflow to the sink so CodeQL recognizes it.
        // eslint-disable-next-line no-console
        console.error(
          redactPii(
            `[${ERROR_IDS.AGENT_DISPATCH_FAILED}] failed to record dispatch-failure audit for deal ${dealId}: ${auditMessage}`,
          ).replace(/[\r\n]/g, ' '),
        );
      }
    } finally {
      span.end();
    }
  });
}
