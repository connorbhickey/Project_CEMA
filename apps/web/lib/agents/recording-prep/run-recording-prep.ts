import { planRecording } from '@cema/agents-recording-prep';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';

import { withRls } from '../../with-rls';

import { recordingAdapter } from './adapter';
import { loadRecordingInput } from './deal-data';
import {
  hasExistingRecordingPackage,
  persistCoverSheet,
  persistRecordingCoordinates,
} from './persist';

const tracer = trace.getTracer('@cema/web-recording-prep');

/**
 * Post-commit Recording Prep dispatcher (spec section 9.8). When a deal enters
 * `recording`, resolve the venue, compose + persist the venue cover sheets (gated
 * where required), submit via the dormant adapter, poll once (single-pass), and
 * record the outcome.
 *
 * Self-resolves identity (mirrors runDocGen). Idempotent: skips a deal whose
 * package already exists. Invoked from the best-effort agent dispatcher, which
 * swallows + records `deal.agent_dispatch_failed` on failure, so this may throw.
 */
export async function runRecordingPrep(dealId: string): Promise<void> {
  return tracer.startActiveSpan('recording.run', async (span) => {
    span.setAttribute('recording.deal_id', dealId);
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

      // Idempotency: the package was already prepared for this deal.
      if (await hasExistingRecordingPackage(org.id, dealId)) {
        span.setAttribute('recording.skipped', 'already_prepared');
        span.setStatus({ code: SpanStatusCode.OK });
        return;
      }

      const input = await loadRecordingInput(org.id, dealId);
      if (!input) {
        span.setAttribute('recording.skipped', 'missing_data');
        span.setStatus({ code: SpanStatusCode.OK });
        return;
      }

      const plan = planRecording(input);
      span.setAttribute('recording.venue', plan.venue);
      span.setAttribute('recording.cover_sheet_count', plan.coverSheets.length);

      // Split audit (part 1): the decision BEFORE any write. PII-safe metadata.
      await withRls(org.id, (tx) =>
        emitAuditEvent(tx, {
          organizationId: org.id,
          actorUserId: user.id,
          action: 'recording.evaluated',
          entityType: 'deal',
          entityId: dealId,
          metadata: { venue: plan.venue, count: plan.coverSheets.length },
        }),
      );

      for (const sheet of plan.coverSheets) {
        await persistCoverSheet(org.id, user.id, dealId, sheet);
      }

      // Split audit (part 2): cover sheets persisted -- the dormant/pending terminal.
      await withRls(org.id, (tx) =>
        emitAuditEvent(tx, {
          organizationId: org.id,
          actorUserId: user.id,
          action: 'recording.prepared',
          entityType: 'deal',
          entityId: dealId,
          metadata: { venue: plan.venue, count: plan.coverSheets.length },
        }),
      );

      const submission = await recordingAdapter.submit(plan);
      // Live/test-only: the dormant Fixture returns submitted:false, so the
      // accepted/rejected branches below never run in production until a real
      // Simplifile/ACRIS adapter is wired.
      if (submission.submitted && submission.submissionId) {
        const result = await recordingAdapter.poll(submission.submissionId);
        span.setAttribute('recording.status', result.status);
        if (result.status === 'accepted' && result.recordingRef) {
          await persistRecordingCoordinates(
            org.id,
            dealId,
            plan.venue,
            result.recordingRef,
            new Date().toISOString(),
          );
          await withRls(org.id, (tx) =>
            emitAuditEvent(tx, {
              organizationId: org.id,
              actorUserId: user.id,
              action: 'recording.completed',
              entityType: 'deal',
              entityId: dealId,
              metadata: { venue: plan.venue },
            }),
          );
        } else if (result.status === 'rejected') {
          await withRls(org.id, (tx) =>
            emitAuditEvent(tx, {
              organizationId: org.id,
              actorUserId: user.id,
              action: 'recording.rejected',
              entityType: 'deal',
              entityId: dealId,
              metadata: { venue: plan.venue, reason: result.rejectionReason ?? 'unspecified' },
            }),
          );
        }
      }
      span.setStatus({ code: SpanStatusCode.OK });
    } finally {
      span.end();
    }
  });
}
