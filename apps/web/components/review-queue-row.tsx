import Link from 'next/link';

import type { ReviewQueueItem } from '@/lib/actions/list-review-queue';

const STATE_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  claimed: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

interface ReviewQueueRowProps {
  item: ReviewQueueItem;
}

export function ReviewQueueRow({ item }: ReviewQueueRowProps) {
  const { queue, document, submittedBy, reviewer } = item;
  return (
    <Link
      href={`/attorney/queue/${queue.id}`}
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {document?.kind ?? `Document ${queue.documentId}`} (v{queue.documentVersion})
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Submitted by {submittedBy?.email ?? queue.submittedById} ·{' '}
            {formatDate(queue.submittedAt)}
          </p>
          {reviewer ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              Claimed by {reviewer.email} · {formatDate(queue.claimedAt)}
            </p>
          ) : null}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATE_BADGE[queue.state] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {queue.state}
        </span>
      </div>
    </Link>
  );
}
