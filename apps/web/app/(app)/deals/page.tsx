import { FolderOpen, Plus } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { DealRowItem } from '@/components/deal-row';
import { listDeals } from '@/lib/actions/list-deals';
import {
  DEAL_STATUS_LABELS,
  dealStatusLabel,
  parseDealStatusFilter,
} from '@/lib/deals/deal-status';
import { routeHref } from '@/lib/routes';

// ─── Constants ───────────────────────────────────────────────────────────────

const NEW_DEAL_HREF = '/deals/new' as Route<'/deals/new'>;

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function Page({ searchParams }: PageProps) {
  const { status: rawStatus } = await searchParams;
  const status = parseDealStatusFilter(rawStatus);
  const deals = await listDeals(status ?? undefined);

  return (
    // Canvas: bg-muted cool-gray so bg-card table pops — matches the dashboard
    <div className="bg-muted -m-6 min-h-full p-5">
      {/* Page header */}
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-extrabold tracking-tight">Deals</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {status ? (
              <>
                Filtered by{' '}
                <strong className="text-foreground font-semibold">{dealStatusLabel(status)}</strong>{' '}
                ·{' '}
                <strong className="text-foreground font-semibold tabular-nums">
                  {deals.length}
                </strong>{' '}
                {deals.length === 1 ? 'deal' : 'deals'}
              </>
            ) : (
              <>
                <strong className="text-foreground font-semibold tabular-nums">
                  {deals.length}
                </strong>{' '}
                {deals.length === 1 ? 'deal' : 'deals'} in your pipeline
              </>
            )}
          </p>
        </div>

        {/* New deal CTA — matches dashboard's secondary button style */}
        <Link
          href={NEW_DEAL_HREF}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold shadow-sm transition-colors"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          New deal
        </Link>
      </div>

      {/* Status filter chips */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip href="/deals" label="All" active={status === null} />
        {(Object.keys(DEAL_STATUS_LABELS) as (keyof typeof DEAL_STATUS_LABELS)[]).map((s) => (
          <FilterChip
            key={s}
            href={{ pathname: '/deals', query: { status: s } }}
            label={DEAL_STATUS_LABELS[s]}
            active={status === s}
          />
        ))}
      </div>

      {/* Table card */}
      <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
        {deals.length === 0 ? (
          <EmptyState status={status} />
        ) : (
          <>
            {/* Table header */}
            <div className="border-border bg-muted/60 flex min-h-[36px] items-center border-b">
              <div className="flex-1 px-4">
                <span className="text-muted-foreground text-[10.5px] font-semibold uppercase tracking-wider">
                  Deal
                </span>
              </div>
              <div className="hidden flex-[1.4] px-4 sm:block">
                <span className="text-muted-foreground text-[10.5px] font-semibold uppercase tracking-wider">
                  Property
                </span>
              </div>
              <div className="w-36 shrink-0 px-4">
                <span className="text-muted-foreground text-[10.5px] font-semibold uppercase tracking-wider">
                  Stage
                </span>
              </div>
              <div className="hidden w-28 shrink-0 px-4 md:block">
                <span className="text-muted-foreground text-[10.5px] font-semibold uppercase tracking-wider">
                  Created
                </span>
              </div>
            </div>

            {/* Rows */}
            <div>
              {deals.map((deal) => (
                <DealRowItem key={deal.id} deal={deal} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Filter chip ──────────────────────────────────────────────────────────────

function FilterChip({
  href,
  label,
  active,
}: {
  href: string | { pathname: string; query: Record<string, string> };
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={typeof href === 'string' ? routeHref(href) : href}
      className={[
        'inline-flex h-7 items-center rounded-full border px-3 text-[11.5px] font-semibold transition-colors',
        active
          ? 'border-teal-600/30 bg-teal-500/10 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/15 dark:text-teal-400'
          : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ status }: { status: ReturnType<typeof parseDealStatusFilter> }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-muted mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
        <FolderOpen className="h-6 w-6 text-teal-600 dark:text-teal-400" strokeWidth={1.5} />
      </div>
      <p className="text-foreground text-sm font-semibold">
        {status ? `No deals in ${dealStatusLabel(status)}` : 'No deals yet'}
      </p>
      <p className="text-muted-foreground mt-1 text-[12.5px]">
        {status
          ? 'Try selecting a different stage, or clear the filter to see all deals.'
          : 'Click "New deal" to create your first CEMA deal.'}
      </p>
      {status && (
        <Link
          href="/deals"
          className="mt-3 text-[12.5px] font-semibold text-teal-600 hover:underline dark:text-teal-400"
        >
          Clear filter
        </Link>
      )}
    </div>
  );
}
