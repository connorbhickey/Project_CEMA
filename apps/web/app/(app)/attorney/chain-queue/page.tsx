import { Link2 } from 'lucide-react';

import { DealStatusBadge } from '@/components/deal-status-badge';
import { InboxRow } from '@/components/queue/inbox-row';
import { QueueStateBadge } from '@/components/queue/queue-state-badge';
import { chainBreakKindLabel } from '@/lib/chain/chain-break-labels';
import { chainQueueSummary } from '@/lib/chain-queue-summary';
import { getOrgChainBreakReviews } from '@/lib/queries/org-chain-break-reviews';

export default async function Page() {
  const items = await getOrgChainBreakReviews({ stateFilter: 'open' });
  const summary = chainQueueSummary(items);

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-foreground text-2xl font-extrabold tracking-tight">
          Chain-of-title review queue
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {summary.total === 0 ? (
            'Open chain-of-title breaks awaiting an attorney, across all deals.'
          ) : (
            <>
              <strong className="text-foreground font-semibold tabular-nums">
                {summary.total}
              </strong>{' '}
              open —{' '}
              <strong className="text-foreground font-semibold tabular-nums">
                {summary.pending}
              </strong>{' '}
              pending,{' '}
              <strong className="text-foreground font-semibold tabular-nums">
                {summary.claimed}
              </strong>{' '}
              claimed.
            </>
          )}
        </p>
      </div>

      {/* Inbox card */}
      <div
        role="list"
        aria-label="Chain-of-title review queue"
        className="bg-card border-border overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]"
      >
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          items.map((item) => (
            <InboxRow
              key={item.id}
              href={`/deals/${item.dealId}/documents`}
              icon={Link2}
              iconTint="text-cyan-600 dark:text-cyan-400"
              iconBg="bg-cyan-500/10"
              title={chainBreakKindLabel(item.breakKind)}
              sub={item.reason}
              badges={
                <>
                  <QueueStateBadge state={item.state} />
                  <DealStatusBadge status={item.dealStatus} />
                </>
              }
            />
          ))
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
        <Link2 className="h-6 w-6 text-teal-600 dark:text-teal-400" strokeWidth={1.5} />
      </div>
      <p className="text-foreground text-sm font-semibold">No chain breaks awaiting review</p>
      <p className="text-muted-foreground mt-1 text-[12.5px]">
        When the Chain-of-Title agent routes a break to attorney review, it appears here. Open a
        deal to claim and resolve its breaks.
      </p>
    </div>
  );
}
