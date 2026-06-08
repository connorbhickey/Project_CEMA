import { format } from 'date-fns';
import type { Route } from 'next';
import Link from 'next/link';

import { type DealRow } from '@/lib/actions/list-deals';
import { dealStatusLabel, type DealStatus } from '@/lib/deals/deal-status';

// ─── Status badge ─────────────────────────────────────────────────────────────

/**
 * Maps each deal_status to a tint + dot color for the status badge.
 * Uses Tailwind utility classes with design-token alignment — no raw hex.
 */
const STATUS_BADGE: Record<DealStatus, { dot: string; badge: string }> = {
  intake: {
    dot: 'bg-teal-500',
    badge: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  },
  eligibility: {
    dot: 'bg-cyan-500',
    badge: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  },
  authorization: {
    dot: 'bg-blue-500',
    badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  },
  collateral_chase: {
    dot: 'bg-sky-500',
    badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  },
  title_work: {
    dot: 'bg-indigo-500',
    badge: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
  },
  doc_prep: {
    dot: 'bg-violet-500',
    badge: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  },
  attorney_review: {
    dot: 'bg-purple-500',
    badge: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  },
  closing: {
    dot: 'bg-blue-600',
    badge: 'bg-blue-600/10 text-blue-700 dark:text-blue-400',
  },
  recording: {
    dot: 'bg-teal-600',
    badge: 'bg-teal-600/10 text-teal-700 dark:text-teal-400',
  },
  completed: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  exception: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  cancelled: {
    dot: 'bg-slate-400',
    badge: 'bg-slate-400/10 text-slate-500 dark:text-slate-400',
  },
};

const FALLBACK_BADGE = {
  dot: 'bg-slate-400',
  badge: 'bg-slate-400/10 text-slate-500 dark:text-slate-400',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE[status as DealStatus] ?? FALLBACK_BADGE;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${style.badge}`}
    >
      <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${style.dot}`} />
      {dealStatusLabel(status)}
    </span>
  );
}

// ─── Deal cema-type label ─────────────────────────────────────────────────────

function cemaTypeLabel(t: DealRow['cemaType']): string {
  return t === 'refi_cema' ? 'Refi CEMA' : 'Purchase CEMA';
}

// ─── Row ─────────────────────────────────────────────────────────────────────

interface DealRowItemProps {
  deal: DealRow;
}

export function DealRowItem({ deal }: DealRowItemProps) {
  const shortId = deal.id.slice(0, 8);
  const address = deal.streetAddress
    ? deal.city
      ? `${deal.streetAddress}, ${deal.city}`
      : deal.streetAddress
    : null;

  return (
    <Link
      href={`/deals/${deal.id}` as Route}
      className="border-border hover:bg-accent/40 group flex min-h-[44px] items-center gap-0 border-b transition-colors last:border-b-0"
    >
      {/* Deal column */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-2.5">
        <div className="min-w-0">
          <span className="text-foreground block text-[13px] font-semibold leading-snug">
            {cemaTypeLabel(deal.cemaType)}
          </span>
          <span className="text-muted-foreground font-mono text-[11px]">{shortId}…</span>
        </div>
      </div>

      {/* Property column */}
      <div className="hidden min-w-0 flex-[1.4] px-4 py-2.5 sm:block">
        {address ? (
          <span className="text-foreground/80 block truncate text-[12.5px]">{address}</span>
        ) : (
          <span className="text-muted-foreground text-[12px] italic">No property</span>
        )}
      </div>

      {/* Stage column */}
      <div className="flex w-36 shrink-0 items-center px-4 py-2.5">
        <StatusBadge status={deal.status} />
      </div>

      {/* Created column */}
      <div className="hidden w-28 shrink-0 items-center px-4 py-2.5 md:flex">
        <span className="text-muted-foreground text-[12px] tabular-nums">
          {format(deal.createdAt, 'MMM d, yyyy')}
        </span>
      </div>
    </Link>
  );
}
