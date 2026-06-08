import { TriangleAlert, Link2, CheckCircle } from 'lucide-react';
import Link from 'next/link';

import { type DealExceptions } from '@/lib/agents/exception-triage/get-org-exceptions';
import { exceptionKindLabel } from '@/lib/exceptions/exception-labels';

interface NeedsYouProps {
  exceptions: DealExceptions[];
}

// Sort highest severity first
function severityOrder(s: string): number {
  if (s === 'critical') return 0;
  if (s === 'high') return 1;
  if (s === 'medium') return 2;
  return 3;
}

export function NeedsYou({ exceptions }: NeedsYouProps) {
  // Flatten exceptions to individual items, ordered by severity, capped at 5
  const items = exceptions
    .flatMap((d) =>
      d.exceptions.map((e) => ({
        dealId: d.dealId,
        dealStatus: d.dealStatus,
        ...e,
      })),
    )
    .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity))
    .slice(0, 5);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
          <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
        </div>
        <p className="text-muted-foreground text-center text-sm">No open exceptions</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => {
        const isHigh = item.severity === 'high' || item.severity === 'blocking';
        return (
          <Link
            key={`${item.dealId}-${item.kind}-${i}`}
            href={`/deals/${item.dealId}`}
            className="group block"
          >
            <div
              className={`flex items-center gap-2.5 rounded-xl border p-2.5 transition-all group-hover:shadow-sm ${
                isHigh
                  ? 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30'
                  : 'border-border bg-muted/50'
              }`}
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  isHigh ? 'bg-rose-100 dark:bg-rose-900/50' : 'bg-amber-100 dark:bg-amber-900/40'
                }`}
              >
                {item.kind === 'chain_break' ? (
                  <Link2
                    className={`h-4 w-4 ${isHigh ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}
                    strokeWidth={2}
                  />
                ) : (
                  <TriangleAlert
                    className={`h-4 w-4 ${isHigh ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}
                    strokeWidth={2}
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-foreground truncate text-[12.5px] font-semibold">
                  {exceptionKindLabel(item.kind)}
                </div>
                <div className="text-muted-foreground truncate font-mono text-[11px]">
                  {item.dealId.slice(0, 13)}… · {item.dealStatus.replace(/_/g, ' ')}
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
