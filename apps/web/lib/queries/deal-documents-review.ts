import type { ReviewState } from '@cema/attorney';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import type { InstrumentRecord } from '@cema/collateral';
import { documentReviewQueue, documents, getDb, organizations, users } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { isInstrumentRecord } from './deal-chain-findings';

import { generatedDocFields, type DocField } from '@/lib/deals/generated-doc-fields';
import { withRls } from '@/lib/with-rls';

export interface DealDocumentReviewItem {
  readonly documentId: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
  readonly attorneyReviewRequired: boolean;
  readonly instrument: InstrumentRecord | null;
  // For a GENERATED document (Doc-Gen / Recording-Prep): its field-map amounts.
  // Mutually exclusive with `instrument` (a doc is classified collateral XOR generated).
  readonly generatedFields: DocField[] | null;
  readonly queueId: string | null;
  readonly reviewState: ReviewState | null;
  readonly reviewerIsCurrentUser: boolean;
}

/**
 * Loads every document on a deal, left-joined to its active review-queue row
 * (one per document_id + version). Gate-required documents sort first so the
 * attorney/processor sees actionable items at the top. RLS-scoped: tenancy
 * flows documents.dealId -> deals.organizationId, enforced by withRls.
 */
export async function getDealDocumentsReview(dealId: string): Promise<DealDocumentReviewItem[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  // Resolved outside withRls: a globally-unique clerkUserId lookup for the
  // UI-only `reviewerIsCurrentUser` flag (never a security gate), mirroring
  // submit-for-review.ts. Move inside withRls if `users` ever gets an RLS policy.
  let currentUserId: string | null = null;
  if (clerkUser) {
    const u = await db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkUser.id),
    });
    currentUserId = u?.id ?? null;
  }

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({
        documentId: documents.id,
        kind: documents.kind,
        status: documents.status,
        version: documents.version,
        attorneyReviewRequired: documents.attorneyReviewRequired,
        extractedData: documents.extractedData,
        queueId: documentReviewQueue.id,
        reviewState: documentReviewQueue.state,
        reviewerId: documentReviewQueue.reviewerId,
      })
      .from(documents)
      .leftJoin(
        documentReviewQueue,
        and(
          eq(documentReviewQueue.documentId, documents.id),
          eq(documentReviewQueue.documentVersion, documents.version),
        ),
      )
      .where(eq(documents.dealId, dealId));

    const items: DealDocumentReviewItem[] = rows.map((r) => ({
      documentId: r.documentId,
      kind: r.kind,
      status: r.status,
      version: r.version,
      attorneyReviewRequired: r.attorneyReviewRequired,
      instrument: isInstrumentRecord(r.extractedData) ? r.extractedData : null,
      generatedFields: isInstrumentRecord(r.extractedData)
        ? null
        : generatedDocFields(r.extractedData),
      queueId: r.queueId ?? null,
      reviewState: r.reviewState ?? null,
      reviewerIsCurrentUser:
        r.reviewerId !== null && currentUserId !== null && r.reviewerId === currentUserId,
    }));

    items.sort((a, b) => {
      if (a.attorneyReviewRequired !== b.attorneyReviewRequired) {
        return a.attorneyReviewRequired ? -1 : 1;
      }
      return a.kind.localeCompare(b.kind);
    });

    return items;
  });
}
