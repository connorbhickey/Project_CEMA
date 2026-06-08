import { format } from 'date-fns';
import Link from 'next/link';

import { DealStatusBadge } from './deal-status-badge';

import { type DealRow } from '@/lib/actions/list-deals';
import { routeHref } from '@/lib/routes';

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
      href={routeHref(`/deals/${deal.id}`)}
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
        <DealStatusBadge status={deal.status} />
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
