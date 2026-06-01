import type {
  ClassifiedDoc,
  IdpAdapter,
  IdpAuditEvent,
  IdpContext,
  IdpDeps,
} from '@cema/agents-collateral-idp';
import { emitAuditEvent } from '@cema/compliance';
import { documentReviewQueue, documents } from '@cema/db';
import { and, eq, isNotNull } from 'drizzle-orm';

import { withRls } from '../../with-rls';

interface BuildIdpDepsArgs {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly idp: IdpAdapter;
}

/**
 * Builds IdpDeps for the app. Every effect runs inside withRls so the deal's
 * documents are tenant-scoped (the documents table has no organizationId
 * column -- tenancy flows through deal_id -> deals). persistDocuments enriches
 * each collateral row 1:1 in place and writes the co-transactional
 * idp.documents_classified audit in the SAME transaction (mirroring M12
 * recordTouch), so the classify + the audit cannot diverge.
 */
export function buildIdpDeps({ organizationId, actorUserId, idp }: BuildIdpDepsArgs): IdpDeps {
  return {
    idp,

    loadContext(dealId: string): Promise<IdpContext> {
      return withRls(organizationId, async (tx) => {
        const rows = await tx
          .select({ documentId: documents.id, blobUrl: documents.blobUrl })
          .from(documents)
          .where(and(eq(documents.dealId, dealId), isNotNull(documents.blobUrl)));
        return {
          dealId,
          documents: rows
            .filter((r): r is { documentId: string; blobUrl: string } => r.blobUrl !== null)
            .map((r) => ({ documentId: r.documentId, blobUrl: r.blobUrl })),
        };
      });
    },

    persistDocuments(dealId: string, docs: readonly ClassifiedDoc[]): Promise<void> {
      return withRls(organizationId, async (tx) => {
        for (const doc of docs) {
          const [updated] = await tx
            .update(documents)
            .set({
              kind: doc.kind,
              attorneyReviewRequired: doc.attorneyReviewRequired,
              extractedData: doc.instrument as unknown as Record<string, unknown>,
            })
            .where(eq(documents.id, doc.documentId))
            .returning({ version: documents.version });

          // Auto-enqueue gate-required docs (hard rule #2) so the attorney
          // review queue fills without a manual UI submit. Enqueue-only: the
          // queue row is the signal the review surface keys off
          // (deal-documents-review.ts derives actionability from queueId, and
          // the claim/approve state machine runs on documentReviewQueue.state)
          // -- we deliberately do NOT flip documents.status here, leaving the
          // document's lifecycle to the processor/attorney. onConflictDoNothing
          // on (documentId, documentVersion) makes a durable IDP replay a no-op.
          if (updated && doc.attorneyReviewRequired) {
            const [queued] = await tx
              .insert(documentReviewQueue)
              .values({
                organizationId,
                documentId: doc.documentId,
                documentVersion: updated.version,
                submittedById: actorUserId,
                state: 'pending',
              })
              .onConflictDoNothing({
                target: [documentReviewQueue.documentId, documentReviewQueue.documentVersion],
              })
              .returning({ id: documentReviewQueue.id });

            // Empty array == a row already existed for this (doc, version), so
            // the audit fires only on a real insert -- re-runs stay idempotent.
            if (queued) {
              await emitAuditEvent(tx, {
                organizationId,
                actorUserId,
                action: 'document.submitted_for_review',
                entityType: 'document',
                entityId: doc.documentId,
                metadata: {
                  queueId: queued.id,
                  version: updated.version,
                  source: 'collateral-idp',
                },
              });
            }
          }
        }
        const gateRequiredCount = docs.filter((d) => d.attorneyReviewRequired).length;
        await emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: 'idp.documents_classified',
          entityType: 'deal',
          entityId: dealId,
          metadata: {
            source: 'collateral-idp',
            documentCount: docs.length,
            gateRequiredCount,
          },
        });
      });
    },

    emitAudit(event: IdpAuditEvent): Promise<void> {
      return withRls(organizationId, (tx) =>
        emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: event.action,
          entityType: 'deal',
          entityId: event.dealId,
          metadata: {
            source: 'collateral-idp',
            documentCount: event.documentCount,
            unreadableCount: event.unreadableCount,
            gateRequiredCount: event.gateRequiredCount,
          },
        }).then(() => undefined),
      );
    },
  };
}
