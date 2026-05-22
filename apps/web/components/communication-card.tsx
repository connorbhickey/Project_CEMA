import type { communications } from '@cema/db';

type Communication = typeof communications.$inferSelect;

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  ingested: 'bg-blue-100 text-blue-700',
  transcribing: 'bg-yellow-100 text-yellow-700',
  ready: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
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
    <div className="flex items-center gap-4 rounded-lg border bg-white p-4 shadow-sm">
      {/* Direction indicator */}
      <div
        aria-label={isOutbound ? 'Outbound call' : 'Inbound call'}
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          isOutbound ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
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
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {comm.provider}
        </span>
      )}

      {/* Status pill */}
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[comm.status] ?? 'bg-gray-100 text-gray-600'}`}
      >
        {comm.status}
      </span>
    </div>
  );
}
