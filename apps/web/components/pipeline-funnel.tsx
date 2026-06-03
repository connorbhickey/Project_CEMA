import Link from 'next/link';

import { type PipelineStage, type PipelineSummary } from '@/lib/dashboard/pipeline-summary';

function Stage({ label, count, muted }: { label: string; count: number; muted: boolean }) {
  return (
    <div
      className={`min-w-20 rounded-md border px-3 py-2 text-center ${muted ? 'opacity-50' : ''}`}
    >
      <div className="text-foreground text-xl font-semibold tabular-nums">{count}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}

// A non-zero stage links to the deals list filtered to its status; a zero stage
// is inert (nothing to drill into).
function StageBox({ stage }: { stage: PipelineStage }) {
  const box = <Stage label={stage.label} count={stage.count} muted={stage.count === 0} />;
  if (stage.count === 0) return box;
  return (
    <Link
      href={{ pathname: '/deals', query: { status: stage.status } }}
      className="rounded-md transition-opacity hover:opacity-80"
    >
      {box}
    </Link>
  );
}

export function PipelineFunnel({ summary }: { summary: PipelineSummary }) {
  if (summary.total === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Deals will appear here as they enter the pipeline.
      </p>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-2">
        {summary.stages.map((s) => (
          <StageBox key={s.status} stage={s} />
        ))}
        <div className="bg-border mx-1 w-px self-stretch" aria-hidden />
        {summary.offRamps.map((s) => (
          <StageBox key={s.status} stage={s} />
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {summary.activeTotal} active · {summary.total} total
      </p>
    </div>
  );
}
