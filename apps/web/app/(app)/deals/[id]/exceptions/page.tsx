import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { notFound } from 'next/navigation';

import { BentoCard } from '@/components/deal-hub/bento-card';
import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
import { SeverityBadge } from '@/components/queue/severity-badge';
import { getDeal } from '@/lib/actions/get-deal';
import { getDealExceptions } from '@/lib/agents/exception-triage/get-deal-exceptions';
import { exceptionKindLabel, exceptionRouteLabel } from '@/lib/exceptions/exception-labels';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) notFound();

  const exceptions = await getDealExceptions(id);

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={id} active="exceptions" />

      <BentoCard
        icon={
          <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" strokeWidth={2} />
        }
        iconTile="bg-amber-500/10"
        title={`Exceptions${exceptions.length > 0 ? ` (${exceptions.length})` : ''}`}
      >
        {exceptions.length === 0 ? (
          <div className="flex items-center gap-2 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2} />
            No open exceptions on this deal.
          </div>
        ) : (
          <ul className="space-y-2" role="list" aria-label="Deal exceptions">
            {exceptions.map((e) => (
              <li key={e.kind} className="border-border rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={e.severity} />
                  <span className="text-foreground text-[13px] font-semibold">
                    {exceptionKindLabel(e.kind)}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    → {exceptionRouteLabel(e.route)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-[12.5px]">{e.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </BentoCard>
    </div>
  );
}
