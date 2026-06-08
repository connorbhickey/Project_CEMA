import { Scale } from 'lucide-react';

import { ReviewQueueRow } from '@/components/review-queue-row';
import { listReviewQueue } from '@/lib/actions/list-review-queue';

export default async function Page() {
  const items = await listReviewQueue({ stateFilter: 'all' });

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-foreground text-2xl font-extrabold tracking-tight">
          Attorney review queue
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {items.length === 0 ? (
            'Documents awaiting attorney review, across all deals.'
          ) : (
            <>
              <strong className="text-foreground font-semibold tabular-nums">{items.length}</strong>{' '}
              document{items.length === 1 ? '' : 's'} in the queue.
            </>
          )}
        </p>
      </div>

      {/* Inbox card */}
      <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          items.map((item) => <ReviewQueueRow key={item.queue.id} item={item} />)
        )}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-muted mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
        <Scale className="h-6 w-6 text-teal-600 dark:text-teal-400" strokeWidth={1.5} />
      </div>
      <p className="text-foreground text-sm font-semibold">No documents awaiting review</p>
      <p className="text-muted-foreground mt-1 text-[12.5px]">
        When a processor submits a CEMA document for review, it will appear here.
      </p>
    </div>
  );
}
