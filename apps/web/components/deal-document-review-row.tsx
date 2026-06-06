import { DealDocumentReviewActions } from '@/components/deal-document-review-actions';
import type { DealDocumentReviewItem } from '@/lib/queries/deal-documents-review';

/**
 * One document row on the deal Documents surface: kind / version / status / the
 * attorney-gate + review-state badges, the classified-instrument detail grid
 * (collateral only), and the claim/submit review actions. Shared by the
 * Collateral / Generated / Other groups so they render identically.
 */
export function DealDocumentReviewRow({ item }: { item: DealDocumentReviewItem }) {
  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{item.kind}</span>
        <span className="text-muted-foreground">v{item.version}</span>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{item.status}</span>
        {item.attorneyReviewRequired ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            attorney gate
          </span>
        ) : null}
        <span className="text-muted-foreground rounded px-2 py-0.5 text-xs">
          {item.reviewState ?? '—'}
        </span>
      </div>

      {item.attorneyReviewRequired && item.instrument ? (
        <dl className="text-muted-foreground mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          <div className="flex gap-1">
            <dt>Assignor → Assignee:</dt>
            <dd className="text-foreground">
              {item.instrument.assignor ?? '—'} → {item.instrument.assignee ?? '—'}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Amount:</dt>
            <dd className="text-foreground">
              {item.instrument.amount !== null ? `$${item.instrument.amount}` : '—'}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Recording:</dt>
            <dd className="text-foreground">
              {item.instrument.recordingRef.crfn ?? item.instrument.recordingRef.reelPage ?? '—'}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>County:</dt>
            <dd className="text-foreground">{item.instrument.county ?? '—'}</dd>
          </div>
        </dl>
      ) : null}

      <div className="mt-3">
        <DealDocumentReviewActions
          documentId={item.documentId}
          attorneyReviewRequired={item.attorneyReviewRequired}
          queueId={item.queueId}
          state={item.reviewState}
          reviewerIsCurrentUser={item.reviewerIsCurrentUser}
        />
      </div>
    </li>
  );
}
