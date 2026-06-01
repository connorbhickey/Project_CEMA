import { notificationForStatus } from '@cema/agents-internal-comms';
import { emitAuditEvent, redactPii } from '@cema/compliance';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import type { DealStatus } from '../../actions/transition-deal-status';
import { ERROR_IDS } from '../../constants/error-ids';
import { withRls } from '../../with-rls';

import { sendInternalComm } from './channel';

const tracer = trace.getTracer('@cema/web-internal-comms');

/** Tenancy + actor context for the notification audit (threaded from the caller
 *  that already resolved the Clerk org + user for the status write). */
export interface NotifyInternalContext {
  organizationId: string;
  actorUserId: string;
}

/**
 * Post-commit internal-comms dispatcher (spec §9.10). Called AFTER a deal-status
 * change has committed + been audited; if the new status warrants a team
 * notification (ready-for-review / awaiting-input / exception), it posts a
 * PII-safe message to the org's internal pipeline channel and records an
 * `internal_comm.notified` audit.
 *
 * BEST-EFFORT by design: a failed notification must never roll back or surface
 * on the status change itself, so every error is swallowed and logged PII-safe.
 * Today this runs IN-REQUEST (the channel adapter is dormant); at real-Slack
 * activation the send should become fire-and-forget.
 */
export async function notifyInternal(
  dealId: string,
  toStatus: DealStatus,
  ctx: NotifyInternalContext,
): Promise<void> {
  const notification = notificationForStatus(toStatus);
  if (!notification) return; // routine/terminal status -- nothing to say

  return tracer.startActiveSpan('internal_comm.notify', async (span) => {
    // PII-safe attributes only: opaque dealId + enum/token fields (hard rule #3).
    span.setAttribute('comm.deal_id', dealId);
    span.setAttribute('comm.status', notification.status);
    span.setAttribute('comm.channel', notification.channel);
    try {
      const result = await sendInternalComm({
        dealId,
        status: notification.status,
        channel: notification.channel,
        message: notification.message,
      });
      span.setAttribute('comm.accepted', result.accepted);

      // PII-safe audit: enum/token fields only (never the message body, party
      // names, or amounts -- though the static template carries none anyway).
      await withRls(ctx.organizationId, (tx) =>
        emitAuditEvent(tx, {
          organizationId: ctx.organizationId,
          actorUserId: ctx.actorUserId,
          action: 'internal_comm.notified',
          entityType: 'deal',
          entityId: dealId,
          metadata: {
            status: notification.status,
            channel: notification.channel,
            accepted: result.accepted,
          },
        }),
      );
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      const message = redactPii(err instanceof Error ? err.message : String(err));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      // PII-safe AND log-injection-safe: redact the WHOLE emitted line (hard
      // rule #3) and strip every CR/LF so an untrusted dealId cannot forge a
      // second log entry. The redact+replace MUST stay INLINE in the direct
      // dataflow to console.error -- the quantifier-free /[\r\n]/g is the form
      // CodeQL recognizes as a js/log-injection sanitizer.
      // eslint-disable-next-line no-console
      console.error(
        redactPii(
          `[${ERROR_IDS.INTERNAL_COMM_NOTIFY_FAILED}] internal comm failed for deal ${dealId}: ${message}`,
        ).replace(/[\r\n]/g, ' '),
      );
    } finally {
      span.end();
    }
  });
}
