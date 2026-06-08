import { FileText } from 'lucide-react';

import { InboxRow } from '@/components/queue/inbox-row';
import { QueueStateBadge } from '@/components/queue/queue-state-badge';
import type { ReviewQueueItem } from '@/lib/actions/list-review-queue';
import { documentKindLabel } from '@/lib/deals/document-kind';

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

interface ReviewQueueRowProps {
  item: ReviewQueueItem;
}

export function ReviewQueueRow({ item }: ReviewQueueRowProps) {
  const { queue, document, submittedBy, reviewer } = item;

  const kindLabel = document?.kind
    ? documentKindLabel(document.kind)
    : `Document ${queue.documentId}`;

  const submitterLabel = submittedBy?.email ?? queue.submittedById;
  const subLine = reviewer
    ? `Submitted by ${submitterLabel} · ${formatDate(queue.submittedAt)} · claimed by ${reviewer.email}`
    : `Submitted by ${submitterLabel} · ${formatDate(queue.submittedAt)}`;

  return (
    <InboxRow
      href={`/attorney/queue/${queue.id}`}
      icon={FileText}
      iconTint="text-blue-600 dark:text-blue-400"
      iconBg="bg-blue-500/10"
      title={`${kindLabel} · v${queue.documentVersion}`}
      sub={subLine}
      badges={<QueueStateBadge state={queue.state} />}
    />
  );
}
