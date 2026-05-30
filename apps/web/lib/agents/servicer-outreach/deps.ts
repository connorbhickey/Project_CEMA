import type {
  OutreachContext,
  OutreachDeps,
  ServicerChannelAdapter,
  SubmissionMethod,
} from '@cema/agents-servicer-outreach';
import { emitAuditEvent } from '@cema/compliance';
import { communications, existingLoans, servicerCemaDepartments, servicers } from '@cema/db';
import { and, asc, eq, isNotNull } from 'drizzle-orm';

import { withRls } from '../../with-rls';

export interface BuildOutreachDepsArgs {
  organizationId: string;
  actorUserId: string;
  channel: ServicerChannelAdapter;
}

/**
 * Derives a stable thread ID for outreach communications. All touches for a
 * deal share the same `sourceThreadId` so `loadContext` can count sent touches
 * with a single equality filter.
 */
const threadId = (dealId: string) => `outreach:${dealId}`;

/**
 * Wires the orchestration-agnostic Servicer Outreach core to the app's real
 * persistence layer. Mirrors the buildIntakeDeps pattern (plan Decision 1):
 * every effectful I/O is injected; the orchestrator core imports nothing from
 * here. Column names reflect the actual Drizzle schema:
 *   servicers.legalName   (not .name)
 *   servicerCemaDepartments.email / .acceptedSubmissionMethods / .servicerId
 *   existingLoans.currentServicerId / .chainPosition
 *   communications.vendorEventId (UNIQUE index = idempotency guard)
 */
export function buildOutreachDeps(args: BuildOutreachDepsArgs): OutreachDeps {
  const { organizationId, actorUserId, channel } = args;

  return {
    channel,

    now: () => new Date(),

    loadContext: (dealId: string): Promise<OutreachContext> =>
      withRls(organizationId, async (tx) => {
        // Find the primary servicer for this deal (lowest chain position).
        const [loan] = await tx
          .select({ servicerId: existingLoans.currentServicerId })
          .from(existingLoans)
          .where(and(eq(existingLoans.dealId, dealId), isNotNull(existingLoans.currentServicerId)))
          .orderBy(asc(existingLoans.chainPosition))
          .limit(1);

        let servicerName: string | null = null;
        let departmentEmail: string | null = null;
        let acceptedSubmissionMethods: SubmissionMethod[] = [];

        if (loan?.servicerId) {
          // servicers.legalName is the canonical name column (see packages/db/src/schema/servicers.ts).
          const [servicer] = await tx
            .select({ legalName: servicers.legalName })
            .from(servicers)
            .where(eq(servicers.id, loan.servicerId))
            .limit(1);
          servicerName = servicer?.legalName ?? null;

          const [dept] = await tx
            .select({
              email: servicerCemaDepartments.email,
              accepted: servicerCemaDepartments.acceptedSubmissionMethods,
            })
            .from(servicerCemaDepartments)
            .where(eq(servicerCemaDepartments.servicerId, loan.servicerId))
            .limit(1);
          departmentEmail = dept?.email ?? null;
          acceptedSubmissionMethods = (dept?.accepted ?? []);
        }

        // Count sent touches via communications rows we own (sourceThreadId scopes to this deal's
        // outreach thread). createdAt of the first touch anchors the cadence clock.
        const touches = await tx
          .select({ createdAt: communications.createdAt })
          .from(communications)
          .where(
            and(
              eq(communications.dealId, dealId),
              eq(communications.organizationId, organizationId),
              eq(communications.direction, 'outbound'),
              eq(communications.kind, 'email'),
              eq(communications.sourceThreadId, threadId(dealId)),
            ),
          )
          .orderBy(asc(communications.createdAt));

        return {
          dealId,
          organizationId,
          servicerName,
          departmentEmail,
          acceptedSubmissionMethods,
          // triggeredAt = earliest recorded touch (stable cadence anchor).
          // On the first ever run, `touches` is empty → use now(); the
          // cadence math sees offset 0 (due immediately).
          triggeredAt: touches[0]?.createdAt ?? new Date(),
          touchesSent: touches.length,
          response: null,
        };
      }),

    emitAudit: (event) =>
      withRls(organizationId, (tx) =>
        emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: event.action,
          entityType: 'deal',
          entityId: event.dealId,
          metadata: {
            source: 'servicer-outreach',
            touchNumber: event.touchNumber,
            channel: event.channel,
          },
        }),
      ),

    recordTouch: (record) =>
      withRls(organizationId, async (tx) => {
        // vendorEventId UNIQUE index (communications_vendor_event_id_uidx) provides
        // cross-run idempotency: a duplicate runOutreach evaluation cannot double-insert.
        await tx.insert(communications).values({
          organizationId,
          dealId: record.dealId,
          kind: 'email',
          direction: 'outbound',
          medium: 'other',
          status: 'pending',
          sourceThreadId: threadId(record.dealId),
          vendorEventId: `outreach:${record.dealId}:touch:${record.touchNumber}`,
        });
        // Atomic audit row in the same transaction (same write boundary as the communications row).
        await emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: 'outreach.touch_sent',
          entityType: 'deal',
          entityId: record.dealId,
          metadata: {
            source: 'servicer-outreach',
            touchNumber: record.touchNumber,
            channel: record.channel,
            channelMessageId: record.channelMessageId,
          },
        });
      }),
  };
}
