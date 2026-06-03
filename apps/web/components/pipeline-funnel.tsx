import { type PipelineSummary } from '@/lib/dashboard/pipeline-summary';

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
          <Stage key={s.status} label={s.label} count={s.count} muted={s.count === 0} />
        ))}
        <div className="bg-border mx-1 w-px self-stretch" aria-hidden />
        {summary.offRamps.map((s) => (
          <Stage key={s.status} label={s.label} count={s.count} muted={s.count === 0} />
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {summary.activeTotal} active · {summary.total} total
      </p>
    </div>
  );
}
