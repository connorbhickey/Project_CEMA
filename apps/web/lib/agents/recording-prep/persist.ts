import { type PlannedCoverSheet } from '@cema/agents-recording-prep';
import { type RecordingRef } from '@cema/collateral';
import { emitAuditEvent } from '@cema/compliance';
import { deals, documentReviewQueue, documents } from '@cema/db';
import { and, eq, inArray } from 'drizzle-orm';

import { withRls } from '../../with-rls';

// Either venue cover sheet is the idempotency anchor (exactly one applies per deal).
const COVER_SHEET_ANCHORS = ['acris_cover_pages', 'county_cover_sheet'] as const;

/**
 * Idempotency: if a venue cover sheet already exists for the deal, the package was
 * already prepared -> the run is a no-op. Cheap, migration-free.
 */
export async function hasExistingRecordingPackage(
  organizationId: string,
  dealId: string,
): Promise<boolean> {
  return withRls(organizationId, async (tx) => {
    const [row] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.dealId, dealId), inArray(documents.kind, [...COVER_SHEET_ANCHORS])))
      .limit(1);
    return !!row;
  });
}

/**
 * Insert one cover sheet (draft, gate flag from the plan, field-map in
 * extractedData, no blob) and, if gate-required (county_cover_sheet), enqueue into
 * the attorney review queue (idempotent; emits document.submitted_for_review on a
 * real insert) -- the IDP/Doc-Gen pattern. Co-transactional within one withRls.
 * `documents` is deal-owned (no organizationId column).
 */
export async function persistCoverSheet(
  organizationId: string,
  actorUserId: string,
  dealId: string,
  sheet: PlannedCoverSheet,
): Promise<void> {
  await withRls(organizationId, async (tx) => {
    const [inserted] = await tx
      .insert(documents)
      .values({
        dealId,
        kind: sheet.kind,
        status: 'draft',
        attorneyReviewRequired: sheet.attorneyReviewRequired,
        extractedData: sheet.fields as Record<string, unknown>,
      })
      .returning({ id: documents.id, version: documents.version });
    if (!inserted) return;

    if (!sheet.attorneyReviewRequired) return;

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
      metadata: { queueId: queued.id, version: inserted.version, source: 'recording-prep' },
    });
  });
}

/**
 * Persist the recording coordinates (reel/page OR CRFN) to deals.metadata.recording
 * on acceptance. Read-modify-write the jsonb under one withRls. Asserts the
 * reel-page-XOR-CRFN invariant. Dormant/test-only until a real adapter returns
 * accepted.
 */
export async function persistRecordingCoordinates(
  organizationId: string,
  dealId: string,
  venue: string,
  ref: RecordingRef,
  recordedAt: string,
): Promise<void> {
  const hasReel = !!ref.reelPage;
  const hasCrfn = !!ref.crfn;
  if (hasReel === hasCrfn) {
    throw new Error('recording coordinates must carry exactly one of reelPage / crfn');
  }
  await withRls(organizationId, async (tx) => {
    const [deal] = await tx
      .select({ metadata: deals.metadata })
      .from(deals)
      .where(eq(deals.id, dealId))
      .limit(1);
    if (!deal) return;
    await tx
      .update(deals)
      .set({
        metadata: {
          ...deal.metadata,
          recording: { venue, reelPage: ref.reelPage, crfn: ref.crfn, recordedAt },
        },
      })
      .where(eq(deals.id, dealId));
  });
}
