import type { driveFiles } from '@cema/db';

type DriveFile = typeof driveFiles.$inferSelect;

interface DriveFileCardProps {
  file: DriveFile;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const SYNC_BADGE: Record<string, string> = {
  pending: 'bg-slate-400/10 text-slate-600 dark:text-slate-400',
  syncing: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  synced: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  error: 'bg-red-500/10 text-red-700 dark:text-red-400',
  trashed: 'bg-slate-400/10 text-slate-500 line-through dark:text-slate-500',
};

export function DriveFileCard({ file }: DriveFileCardProps) {
  const href = file.blobUrl ?? '#';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-card border-border hover:bg-accent/40 block rounded-xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05)] transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-label="File">📄</span>
            <p className="truncate text-sm font-medium">{file.fileName ?? '(unnamed)'}</p>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {file.mimeType ?? 'unknown'} · {formatBytes(file.sizeBytes)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="text-muted-foreground text-xs">{formatDate(file.lastSyncedAt)}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SYNC_BADGE[file.syncStatus] ?? 'bg-slate-400/10 text-slate-600 dark:text-slate-400'}`}
          >
            {file.syncStatus}
          </span>
        </div>
      </div>
    </a>
  );
}
