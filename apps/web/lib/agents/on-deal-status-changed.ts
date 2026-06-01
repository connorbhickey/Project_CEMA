import { redactPii } from '@cema/compliance';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import type { DealStatus } from '../actions/transition-deal-status';

import { runCollateralPipeline } from './collateral-pipeline';
import { triggerForStatus } from './on-deal-status-changed-core';
import { runOutreachFromDeal } from './servicer-outreach/run-outreach-action';

const tracer = trace.getTracer('@cema/web-deal-status-dispatch');

/**
 * Post-commit agent dispatcher. Called AFTER a deal-status change has committed
 * and been audited, it fires the Layer-3 agent wired to the new status (if any).
 *
 * BEST-EFFORT by design: a failed agent run must never roll back or surface on
 * the status change itself, so every error is swallowed and logged PII-safe.
 * The status write already succeeded; the agent run is a downstream side effect.
 *
 * Today the agent actions are session-backed Server Actions, so this runs
 * IN-REQUEST (the only trigger path that works without a durable backend or a
 * request session — cron/queue have neither). At durable activation this should
 * become fire-and-forget (enqueue, return immediately).
 */
export async function onDealStatusChanged(dealId: string, toStatus: DealStatus): Promise<void> {
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
      // rule #3, not just the exception message) and collapse any CR/LF so an
      // untrusted dealId can never forge a second log entry (CodeQL
      // js/log-injection).
      const logLine = redactPii(
        `[deal.status_dispatch] ${trigger} failed for deal ${dealId}: ${message}`,
      ).replace(/[\r\n]+/g, ' ');
      // eslint-disable-next-line no-console
      console.error(logLine);
    } finally {
      span.end();
    }
  });
}
