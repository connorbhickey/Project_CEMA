import type { ExceptionSeverity } from '@cema/agents-exception-triage';
import { CheckCircle, Link2, TriangleAlert } from 'lucide-react';

import { DealStatusBadge } from '@/components/deal-status-badge';
import { InboxRow } from '@/components/queue/inbox-row';
import { SeverityBadge, severityStripe } from '@/components/queue/severity-badge';
import { getOrgExceptions } from '@/lib/agents/exception-triage/get-org-exceptions';
import { exceptionKindLabel, exceptionRouteLabel } from '@/lib/exceptions/exception-labels';

// blocking first, low last.
const SEVERITY_RANK: Record<ExceptionSeverity, number> = {
  blocking: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// Icon tint + bg keyed by severity
const SEVERITY_ICON: Record<ExceptionSeverity, { tint: string; bg: string }> = {
  blocking: { tint: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10' },
  high: { tint: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10' },
  medium: { tint: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  low: { tint: 'text-slate-500', bg: 'bg-slate-400/10' },
};

export default async function Page() {
  const deals = await getOrgExceptions();

  // Flatten to one row per (deal, exception), highest severity first.
  const rows = deals
    .flatMap((d) =>
      d.exceptions.map((exception) => ({ dealId: d.dealId, dealStatus: d.dealStatus, exception })),
    )
    .sort((a, b) => SEVERITY_RANK[a.exception.severity] - SEVERITY_RANK[b.exception.severity]);

  const dealCount = new Set(rows.map((r) => r.dealId)).size;

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-foreground text-2xl font-extrabold tracking-tight">Exceptions</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {rows.length === 0 ? (
            'Open exceptions needing a human, across all deals.'
          ) : (
            <>
              <strong className="text-foreground font-semibold tabular-nums">{rows.length}</strong>{' '}
              open exception{rows.length === 1 ? '' : 's'} across{' '}
              <strong className="text-foreground font-semibold tabular-nums">{dealCount}</strong>{' '}
              deal{dealCount === 1 ? '' : 's'}.
            </>
          )}
        </p>
      </div>

      {/* Inbox card */}
      <div
        role="list"
        aria-label="Exceptions"
        className="bg-card border-border overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]"
      >
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          rows.map((row, i) => {
            const { exception, dealId, dealStatus } = row;
            const href =
              exception.kind === 'chain_break' ? `/deals/${dealId}/documents` : `/deals/${dealId}`;
            const iconStyle = SEVERITY_ICON[exception.severity];
            const IconComponent = exception.kind === 'chain_break' ? Link2 : TriangleAlert;
            return (
              <InboxRow
                key={`${dealId}:${exception.kind}:${i}`}
                href={href}
                icon={IconComponent}
                iconTint={iconStyle.tint}
                iconBg={iconStyle.bg}
                stripe={severityStripe(exception.severity)}
                title={exceptionKindLabel(exception.kind)}
                sub={exception.reason}
                badges={
                  <>
                    <SeverityBadge severity={exception.severity} />
                    <span className="text-muted-foreground text-[11px]">
                      → {exceptionRouteLabel(exception.route)}
                    </span>
                    <DealStatusBadge status={dealStatus} />
                  </>
                }
              />
            );
          })
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
        <CheckCircle className="h-6 w-6 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
      </div>
      <p className="text-foreground text-sm font-semibold">No open exceptions</p>
      <p className="text-muted-foreground mt-1 text-[12.5px]">
        When an agent surfaces a chain break, a dispatch failure, a rejected recording, or a deal is
        flagged, it appears here.
      </p>
    </div>
  );
}
