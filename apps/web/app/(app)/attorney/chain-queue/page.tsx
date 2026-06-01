import Link from 'next/link';

import { chainQueueSummary } from '@/lib/chain-queue-summary';
import { getOrgChainBreakReviews } from '@/lib/queries/org-chain-break-reviews';

export default async function Page() {
  const items = await getOrgChainBreakReviews({ stateFilter: 'open' });
  const summary = chainQueueSummary(items);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Chain-of-title review queue</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        {summary.total === 0
          ? 'Open chain-of-title breaks awaiting an attorney, across all deals.'
          : `${summary.total} open — ${summary.pending} pending, ${summary.claimed} claimed.`}
      </p>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">
            No chain breaks awaiting review
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            When the Chain-of-Title agent routes a break to attorney review, it appears here. Open a
            deal to claim and resolve its breaks.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" role="list" aria-label="Chain-of-title review queue">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/deals/${item.dealId}/documents`}
                className="hover:bg-accent block rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{item.breakKind}</span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{item.state}</span>
                  <span className="text-muted-foreground rounded px-2 py-0.5 text-xs">
                    deal {item.dealStatus}
                  </span>
                </div>
                <p className="text-muted-foreground mt-2 text-sm">{item.reason}</p>
                <p className="text-muted-foreground mt-1 text-xs">Deal: {item.dealId}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
