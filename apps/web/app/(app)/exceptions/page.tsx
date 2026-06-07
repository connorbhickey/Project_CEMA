import type { ExceptionSeverity } from '@cema/agents-exception-triage';
import type { Route } from 'next';
import Link from 'next/link';

import { getOrgExceptions } from '@/lib/agents/exception-triage/get-org-exceptions';
import { dealStatusLabel } from '@/lib/deals/deal-status';
import { exceptionKindLabel, exceptionRouteLabel } from '@/lib/exceptions/exception-labels';

// blocking first, low last.
const SEVERITY_RANK: Record<ExceptionSeverity, number> = {
  blocking: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SEVERITY_CLASS: Record<ExceptionSeverity, string> = {
  blocking: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-gray-100 text-gray-700',
};

export default async function Page() {
  const deals = await getOrgExceptions();

  // Flatten to one row per (deal, exception), highest severity first.
  const rows = deals
    .flatMap((d) =>
      d.exceptions.map((exception) => ({ dealId: d.dealId, dealStatus: d.dealStatus, exception })),
    )
    .sort((a, b) => SEVERITY_RANK[a.exception.severity] - SEVERITY_RANK[b.exception.severity]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Exceptions</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        {rows.length === 0
          ? 'Open exceptions needing a human, across all deals.'
          : `${rows.length} open exception${rows.length === 1 ? '' : 's'} across ${deals.length} deal${deals.length === 1 ? '' : 's'}.`}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No open exceptions</p>
          <p className="text-muted-foreground mt-1 text-xs">
            When an agent surfaces a chain break, a dispatch failure, a rejected recording, or a
            deal is flagged, it appears here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" role="list" aria-label="Exception queue">
          {rows.map((row, i) => {
            const href = (
              row.exception.kind === 'chain_break'
                ? `/deals/${row.dealId}/documents`
                : `/deals/${row.dealId}`
            ) as Route;
            return (
              <li key={`${row.dealId}:${row.exception.kind}:${i}`}>
                <Link href={href} className="hover:bg-accent block rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASS[row.exception.severity]}`}
                    >
                      {row.exception.severity}
                    </span>
                    <span className="font-medium">{exceptionKindLabel(row.exception.kind)}</span>
                    <span className="text-muted-foreground rounded px-2 py-0.5 text-xs">
                      → {exceptionRouteLabel(row.exception.route)}
                    </span>
                    <span className="text-muted-foreground rounded px-2 py-0.5 text-xs">
                      deal {dealStatusLabel(row.dealStatus)}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-2 text-sm">{row.exception.reason}</p>
                  <p className="text-muted-foreground mt-1 text-xs">Deal: {row.dealId}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
