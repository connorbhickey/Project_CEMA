import Link from 'next/link';

import { type PipelineSummary } from '@/lib/dashboard/pipeline-summary';

// Short display labels for the pipeline stages that fit in the bar
const SHORT_LABELS: Record<string, string> = {
  intake: 'Intake',
  eligibility: 'Eligibility',
  authorization: 'Authorization',
  collateral_chase: 'Collateral',
  title_work: 'Title Work',
  doc_prep: 'Doc Prep',
  attorney_review: 'Attorney',
  closing: 'Closing',
  recording: 'Recording',
};

const OFF_RAMP_DOTS: Record<string, string> = {
  completed: 'bg-emerald-500',
  exception: 'bg-amber-500',
  cancelled: 'bg-slate-400',
};

interface PipelineFlowProps {
  summary: PipelineSummary;
}

export function PipelineFlow({ summary }: PipelineFlowProps) {
  const maxCount = Math.max(1, ...summary.stages.map((s) => s.count));

  return (
    <div>
      {/* Stage flow */}
      <div className="flex items-end gap-0">
        {summary.stages.map((stage, i) => {
          const barWidth = Math.max(8, Math.round((stage.count / maxCount) * 100));
          const isHighlight = stage.status === 'title_work' || stage.status === 'collateral_chase';
          const num = (
            <span
              className={`text-[22px] font-extrabold tabular-nums tracking-tight ${
                isHighlight ? 'text-teal-600 dark:text-teal-400' : 'text-foreground'
              }`}
            >
              {stage.count}
            </span>
          );
          const label = (
            <span className="text-muted-foreground mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px]">
              {SHORT_LABELS[stage.status] ?? stage.label}
            </span>
          );
          const bar = (
            <div
              className="mt-2 h-[3px] rounded-full bg-gradient-to-r from-teal-600 to-cyan-500"
              style={{ width: `${barWidth}%` }}
            />
          );

          const inner = (
            <div className="min-w-0 flex-1 px-1 pb-1 text-center">
              {num}
              {label}
              {bar}
            </div>
          );

          const connector =
            i < summary.stages.length - 1 ? (
              <div className="border-border mb-[30px] h-px w-[22px] shrink-0 border-t" />
            ) : null;

          return (
            <div key={stage.status} className="flex items-end">
              {stage.count > 0 ? (
                <Link
                  href={{ pathname: '/deals', query: { status: stage.status } }}
                  className="hover:opacity-80"
                >
                  {inner}
                </Link>
              ) : (
                <div className="opacity-50">{inner}</div>
              )}
              {connector}
            </div>
          );
        })}
      </div>

      {/* Off-ramps row */}
      <div className="border-border mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        {summary.offRamps.map((r) => (
          <span
            key={r.status}
            className="border-border bg-card text-foreground inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-semibold"
          >
            <span
              className={`h-[7px] w-[7px] rounded-full ${OFF_RAMP_DOTS[r.status] ?? 'bg-slate-400'}`}
            />
            {r.count.toLocaleString()} {r.label}
          </span>
        ))}
        <span className="text-muted-foreground ml-auto text-[12px]">
          {summary.activeTotal} active · {summary.total} total
        </span>
      </div>
    </div>
  );
}
