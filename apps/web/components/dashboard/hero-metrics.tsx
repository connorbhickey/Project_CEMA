import { CheckCircle, Folder, TriangleAlert } from 'lucide-react';

import { type DealExceptions } from '@/lib/agents/exception-triage/get-org-exceptions';
import { type PipelineSummary } from '@/lib/dashboard/pipeline-summary';

interface HeroCardProps {
  children: React.ReactNode;
  tileClass: string;
  iconSlot: React.ReactNode;
  value: number;
  label: string;
  badge?: React.ReactNode;
}

function HeroCard({ tileClass, iconSlot, value, label, badge }: HeroCardProps) {
  return (
    <div className="bg-card border-border h-full rounded-2xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
      <div className="flex items-start justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tileClass}`}>
          {iconSlot}
        </div>
        {badge}
      </div>
      <div className="text-foreground mt-3 text-3xl font-extrabold tabular-nums tracking-tight">
        {value.toLocaleString()}
      </div>
      <div className="text-muted-foreground mt-0.5 text-[12.5px] font-medium">{label}</div>
    </div>
  );
}

// Inline SVG — check-list icon for "in attorney review"
function ReviewCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

interface HeroMetricsProps {
  pipeline: PipelineSummary;
  exceptions: DealExceptions[];
}

/**
 * Renders an array of 4 hero-metric cards (col-span-3 each). The parent page
 * wraps each in its own HeroCard shell and passes `index` to pick the right one.
 * Exported as a render-prop pattern so the page can place each card independently.
 */
export function HeroMetrics({ pipeline, exceptions }: HeroMetricsProps) {
  const activeDeals = pipeline.activeTotal;

  const attorneyStage = pipeline.stages.find((s) => s.status === 'attorney_review');
  const authStage = pipeline.stages.find((s) => s.status === 'authorization');
  const inReview = (attorneyStage?.count ?? 0) + (authStage?.count ?? 0);

  const openExceptions = exceptions.reduce((n, d) => n + d.exceptions.length, 0);
  const highCount = exceptions
    .flatMap((d) => d.exceptions)
    .filter((e) => e.severity === 'high' || e.severity === 'blocking').length;

  const completedStage = pipeline.offRamps.find((s) => s.status === 'completed');
  const completed = completedStage?.count ?? 0;

  return (
    <>
      <HeroCard
        tileClass="bg-teal-500/10"
        iconSlot={
          <Folder className="h-[18px] w-[18px] text-teal-600 dark:text-teal-400" strokeWidth={2} />
        }
        value={activeDeals}
        label="Active deals"
      >
        {''}
      </HeroCard>

      <HeroCard
        tileClass="bg-blue-500/10"
        iconSlot={
          <ReviewCheckIcon className="h-[18px] w-[18px] text-blue-600 dark:text-blue-400" />
        }
        value={inReview}
        label="In attorney review"
      >
        {''}
      </HeroCard>

      <HeroCard
        tileClass="bg-emerald-500/10"
        iconSlot={
          <CheckCircle
            className="h-[18px] w-[18px] text-emerald-600 dark:text-emerald-400"
            strokeWidth={2}
          />
        }
        value={completed}
        label="Completed deals"
      >
        {''}
      </HeroCard>

      <HeroCard
        tileClass="bg-amber-500/10"
        iconSlot={
          <TriangleAlert
            className="h-[18px] w-[18px] text-amber-600 dark:text-amber-400"
            strokeWidth={2}
          />
        }
        value={openExceptions}
        label="Open exceptions"
        badge={
          highCount > 0 ? (
            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
              {highCount} high
            </span>
          ) : undefined
        }
      >
        {''}
      </HeroCard>
    </>
  );
}
