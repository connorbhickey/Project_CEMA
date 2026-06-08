import type { communications } from '@cema/db';

type Communication = typeof communications.$inferSelect;

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-slate-400/10 text-slate-600 dark:text-slate-400',
  ingested: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  transcribing: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  ready: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

function formatE164(e164: string | null | undefined): string {
  if (!e164) return '—';
  if (e164.length === 12 && e164.startsWith('+1')) {
    return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
  }
  return e164;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatStartedAt(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function CommunicationCard({ comm }: { comm: Communication }) {
  const isOutbound = comm.direction === 'outbound';

  return (
    <div className="bg-card border-border hover:bg-accent/40 flex items-center gap-4 rounded-xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05)] transition-colors">
      {/* Direction indicator */}
      <div
        aria-label={isOutbound ? 'Outbound call' : 'Inbound call'}
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          isOutbound
            ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
        }`}
      >
        {isOutbound ? '↑' : '↓'}
      </div>

      {/* From / To */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{formatE164(comm.fromE164)}</span>
          <span className="text-muted-foreground text-xs">→</span>
          <span className="text-sm">{formatE164(comm.toE164)}</span>
        </div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          {formatStartedAt(comm.startedAt)}
          {comm.durationSeconds ? ` · ${formatDuration(comm.durationSeconds)}` : ''}
        </div>
      </div>

      {/* Provider badge */}
      {comm.provider && (
        <span className="rounded-full bg-slate-400/10 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
          {comm.provider}
        </span>
      )}

      {/* Status pill */}
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[comm.status] ?? 'bg-slate-400/10 text-slate-600 dark:text-slate-400'}`}
      >
        {comm.status}
      </span>
    </div>
  );
}
