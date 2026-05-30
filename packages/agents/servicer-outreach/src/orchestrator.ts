import { withChildSpan } from '@cema/observability';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import { nextOutreachAction, planOutreachCadence } from './cadence';
import { draftOutreachEmail } from './draft';
import type { OutreachDeps, OutreachPacket, OutreachResult } from './types';

const tracer = trace.getTracer('@cema/agents-servicer-outreach');

/**
 * Orchestrates one outreach evaluation for a deal in `collateral_chase`.
 * Orchestration-agnostic: every effect is injected via {@link OutreachDeps}, so
 * the flat await chain maps 1:1 onto a WDK step boundary (PR-5). The pure
 * cadence math (planOutreachCadence + nextOutreachAction) is the legally
 * load-bearing decision; this fn only sequences effects + emits PII-safe spans
 * (ids + booleans only -- never email bodies, servicer rep names, or addresses).
 */
export async function runOutreach(dealId: string, deps: OutreachDeps): Promise<OutreachResult> {
  return tracer.startActiveSpan('outreach.run', async (span) => {
    span.setAttribute('outreach.deal_id', dealId);
    try {
      const context = await withChildSpan(tracer, 'outreach.load_context', () =>
        deps.loadContext(dealId),
      );
      span.setAttribute('outreach.touches_sent', context.touchesSent);
      span.setAttribute('outreach.servicer_identified', context.departmentEmail !== null);

      const cadence = planOutreachCadence({
        triggeredAt: context.triggeredAt,
        acceptedSubmissionMethods: context.acceptedSubmissionMethods,
      });
      span.setAttribute('outreach.channel', cadence.channel ?? 'none');

      // Split audit: the plan is recorded on EVERY run, before any send.
      await withChildSpan(tracer, 'outreach.emit_planned', () =>
        deps.emitAudit({
          action: 'outreach.planned',
          dealId,
          touchNumber: null,
          channel: cadence.channel,
        }),
      );

      const action = nextOutreachAction({
        cadence,
        now: deps.now(),
        touchesSent: context.touchesSent,
        response: context.response,
      });
      span.setAttribute('outreach.action', action.kind);

      // wait / stop / unsupported_channel: nothing to send this run.
      if (action.kind !== 'send') {
        span.setStatus({ code: SpanStatusCode.OK });
        return { dealId, action, touchSent: null };
      }

      // Channel resolved to email but no address on file -> cannot deliver.
      if (!context.departmentEmail) {
        const blocked = { kind: 'unsupported_channel', method: cadence.channel } as const;
        span.setAttribute('outreach.action', blocked.kind);
        span.setStatus({ code: SpanStatusCode.OK });
        return { dealId, action: blocked, touchSent: null };
      }
      const to = context.departmentEmail; // narrowed to string

      // draftOutreachEmail self-spans (outreach.draft_email) -- do NOT double-wrap.
      const draft = await draftOutreachEmail({
        servicerName: context.servicerName,
        touchNumber: action.touchNumber,
        dealReference: dealId,
      });

      const packet: OutreachPacket = {
        channel: 'email',
        to,
        subject: draft.subject,
        body: draft.body,
        touchNumber: action.touchNumber,
        dealId,
      };

      const result = await withChildSpan(tracer, 'outreach.send_touch', () =>
        deps.channel.send(packet),
      );
      span.setAttribute('outreach.send_accepted', result.accepted);

      if (result.accepted) {
        // recordTouch owns the communications-row insert + the outreach.touch_sent
        // audit event co-transactionally.
        await withChildSpan(tracer, 'outreach.record_touch', () =>
          deps.recordTouch({
            dealId,
            touchNumber: action.touchNumber,
            channel: 'email',
            to,
            channelMessageId: result.channelMessageId,
          }),
        );
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return { dealId, action, touchSent: result.accepted ? action.touchNumber : null };
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
