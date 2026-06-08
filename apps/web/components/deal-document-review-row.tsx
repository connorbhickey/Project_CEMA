/**
 * One document row on the deal Documents surface: kind / version / status / the
 * attorney-gate + review-state badges, the classified-instrument detail grid
 * (collateral only), and the claim/submit review actions. Shared by the
 * Collateral / Generated / Other groups so they render identically.
 *
 * Command Center design language: on-brand teal/blue/amber/slate/emerald tokens.
 * No violet / indigo / purple / fuchsia. No raw hex.
 */

import { DealDocumentReviewActions } from '@/components/deal-document-review-actions';
import { QueueStateBadge } from '@/components/queue/queue-state-badge';
import { documentKindLabel } from '@/lib/deals/document-kind';
import { documentStatusLabel } from '@/lib/deals/document-status';
import type { DealDocumentReviewItem } from '@/lib/queries/deal-documents-review';

export function DealDocumentReviewRow({ item }: { item: DealDocumentReviewItem }) {
  return (
    <li className="border-border rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Kind + version */}
        <span className="text-foreground text-[13px] font-semibold">
          {documentKindLabel(item.kind)}
        </span>
        <span className="text-muted-foreground text-[11.5px]">v{item.version}</span>

        {/* Document status pill */}
        <span className="rounded-full bg-slate-400/10 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
          {documentStatusLabel(item.status)}
        </span>

        {/* Attorney gate pill */}
        {item.attorneyReviewRequired ? (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
            Attorney gate
          </span>
        ) : null}

        {/* Review state */}
        {item.reviewState ? <QueueStateBadge state={item.reviewState} /> : null}
      </div>

      {/* Classified instrument detail (collateral group — gate-required only) */}
      {item.attorneyReviewRequired && item.instrument ? (
        <dl className="text-muted-foreground mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-2">
          <div className="flex gap-1">
            <dt>Assignor → Assignee:</dt>
            <dd className="text-foreground">
              {item.instrument.assignor ?? '—'} → {item.instrument.assignee ?? '—'}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Amount:</dt>
            <dd className="text-foreground tabular-nums">
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

      {/* Generated field map (Generated package group) */}
      {item.generatedFields ? (
        <dl className="text-muted-foreground mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-2">
          {item.generatedFields.map((f) => (
            <div key={f.label} className="flex gap-1">
              <dt>{f.label}:</dt>
              <dd className="text-foreground tabular-nums">{f.value}</dd>
            </div>
          ))}
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
