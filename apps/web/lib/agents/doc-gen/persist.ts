import { type PlannedDocument } from '@cema/agents-doc-gen';
import { emitAuditEvent } from '@cema/compliance';
import { documentReviewQueue, documents } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../../with-rls';

/**
 * Idempotency guard: a deal has exactly one cema_3172 (the CEMA agreement). If one
 * already exists, the package was already generated -> the run is a no-op. Cheap,
 * migration-free, and the anchor doc is unique per deal.
 */
export async function hasExistingPackage(organizationId: string, dealId: string): Promise<boolean> {
  return withRls(organizationId, async (tx) => {
    const [row] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.dealId, dealId), eq(documents.kind, 'cema_3172')))
      .limit(1);
    return !!row;
  });
}

/**
 * Insert one generated document (draft, gate flag from the plan, the field-map in
 * extractedData, no blob yet -- dormant render) and, if gate-required, enqueue it
 * into the attorney review queue (idempotent; emits document.submitted_for_review
 * on a real insert) -- the IDP pattern. Co-transactional within one withRls.
 *
 * `documents` is deal-owned (no organizationId column; RLS scopes by deal/org).
 */
export async function persistGeneratedDocument(
  organizationId: string,
  actorUserId: string,
  dealId: string,
  doc: PlannedDocument,
): Promise<void> {
  await withRls(organizationId, async (tx) => {
    const [inserted] = await tx
      .insert(documents)
      .values({
        dealId,
        kind: doc.kind,
        status: 'draft',
        attorneyReviewRequired: doc.attorneyReviewRequired,
        extractedData: doc.fields as Record<string, unknown>,
      })
      .returning({ id: documents.id, version: documents.version });
    if (!inserted) return;

    if (!doc.attorneyReviewRequired) return;

    const [queued] = await tx
      .insert(documentReviewQueue)
      .values({
        organizationId,
        documentId: inserted.id,
        documentVersion: inserted.version,
        submittedById: actorUserId,
      })
      .onConflictDoNothing({
        target: [documentReviewQueue.documentId, documentReviewQueue.documentVersion],
      })
      .returning({ id: documentReviewQueue.id });
    if (!queued) return;

    await emitAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: 'document.submitted_for_review',
      entityType: 'document',
      entityId: inserted.id,
      metadata: { queueId: queued.id, version: inserted.version, source: 'doc-gen' },
    });
  });
}
