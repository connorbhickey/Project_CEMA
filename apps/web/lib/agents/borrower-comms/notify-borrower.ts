import { borrowerNotificationForStatus } from '@cema/agents-borrower-comms';
import { emitAuditEvent, redactPii } from '@cema/compliance';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import type { DealStatus } from '../../actions/transition-deal-status';
import { ERROR_IDS } from '../../constants/error-ids';
import { withRls } from '../../with-rls';

import { sendBorrowerComm } from './channel';
import { loadBorrowerParties } from './parties';

const tracer = trace.getTracer('@cema/web-borrower-comms');

/** Tenancy + actor context for the notification audits. */
export interface NotifyBorrowerContext {
  organizationId: string;
  actorUserId: string;
}

/**
 * Post-commit borrower-comms dispatcher (spec §9.9). If the new deal status is a
 * borrower touchpoint (authorization / closing / completed), emails every
 * borrower + co_borrower party (with an email) a PII-safe update and split-audits
 * each (borrower_comm.evaluated before send, borrower_comm.notified on success).
 *
 * Email-only (TCPA-exempt -- hard rule #4; the deferred SMS/voice path must call
 * tcpaGuard). BEST-EFFORT: a failed send for one party never blocks the other
 * co-borrowers or the already-committed status write. PII (#3): the recipient
 * email rides only in the send packet, never the audits/logs/spans.
 */
export async function notifyBorrower(
  dealId: string,
  toStatus: DealStatus,
  ctx: NotifyBorrowerContext,
): Promise<void> {
  const notification = borrowerNotificationForStatus(toStatus);
  if (!notification) return; // not a borrower touchpoint

  const recipients = await loadBorrowerParties(ctx.organizationId, dealId);
  if (recipients.length === 0) return; // no borrower with an email -- nothing to send

  for (const recipient of recipients) {
    await tracer.startActiveSpan('borrower_comm.notify', async (span) => {
      // PII-safe attributes only: opaque ids + enum tokens (never email/name/body).
      span.setAttribute('comm.deal_id', dealId);
      span.setAttribute('comm.party_id', recipient.id);
      span.setAttribute('comm.status', notification.status);
      span.setAttribute('comm.channel', notification.channel);
      try {
        // Split audit (part 1): record the decision BEFORE the side effect.
        await withRls(ctx.organizationId, (tx) =>
          emitAuditEvent(tx, {
            organizationId: ctx.organizationId,
            actorUserId: ctx.actorUserId,
            action: 'borrower_comm.evaluated',
            entityType: 'deal',
            entityId: dealId,
            metadata: {
              status: notification.status,
              channel: notification.channel,
              partyId: recipient.id,
            },
          }),
        );

        const result = await sendBorrowerComm({
          dealId,
          partyId: recipient.id,
          status: notification.status,
          channel: notification.channel,
          to: recipient.email,
          subject: notification.subject,
          body: notification.body,
        });
        span.setAttribute('comm.accepted', result.accepted);

        // Split audit (part 2): record success after the side effect.
        await withRls(ctx.organizationId, (tx) =>
          emitAuditEvent(tx, {
            organizationId: ctx.organizationId,
            actorUserId: ctx.actorUserId,
            action: 'borrower_comm.notified',
            entityType: 'deal',
            entityId: dealId,
            metadata: {
              status: notification.status,
              channel: notification.channel,
              partyId: recipient.id,
              accepted: result.accepted,
            },
          }),
        );
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        const message = redactPii(err instanceof Error ? err.message : String(err));
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        // PII-safe + log-injection-safe: redact the whole line + strip CR/LF
        // inline at the sink (quantifier-free /[\r\n]/g is the CodeQL-recognized
        // sanitizer). partyId is opaque (not PII); the email is never in the line.
        // eslint-disable-next-line no-console
        console.error(
          redactPii(
            `[${ERROR_IDS.BORROWER_COMM_NOTIFY_FAILED}] borrower comm failed for deal ${dealId} party ${recipient.id}: ${message}`,
          ).replace(/[\r\n]/g, ' '),
        );
      } finally {
        span.end();
      }
    });
  }
}
