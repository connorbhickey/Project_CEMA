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
  pending: 'bg-gray-100 text-gray-600',
  syncing: 'bg-yellow-100 text-yellow-700',
  synced: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  trashed: 'bg-gray-200 text-gray-500 line-through',
};

export function DriveFileCard({ file }: DriveFileCardProps) {
  const href = file.blobUrl ?? '#';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
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
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${SYNC_BADGE[file.syncStatus] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {file.syncStatus}
          </span>
        </div>
      </div>
    </a>
  );
}
