import type { communications, emailThreads } from '@cema/db';
import type { Route } from 'next';
import Link from 'next/link';

type Communication = typeof communications.$inferSelect;
type EmailThread = typeof emailThreads.$inferSelect;

interface EmailThreadCardProps {
  communication: Communication;
  emailThread: EmailThread | null;
  dealId: string;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function EmailThreadCard({ communication, emailThread, dealId }: EmailThreadCardProps) {
  const attachmentCount = emailThread?.nylasAttachmentIds?.length ?? 0;

  return (
    <Link
      href={`/deals/${dealId}/communications/${communication.id}` as Route}
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-label="Email" className="text-muted-foreground text-xs">
              ✉
            </span>
            <p className="truncate text-sm font-medium">{emailThread?.subject ?? '(no subject)'}</p>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {emailThread?.fromEmail ?? '—'}
          </p>
          {emailThread?.snippet ? (
            <p className="text-muted-foreground mt-1 truncate text-xs">{emailThread.snippet}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="text-muted-foreground text-xs">{formatDate(communication.startedAt)}</p>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
            {communication.medium}
          </span>
          {emailThread?.hasAttachments && attachmentCount > 0 ? (
            <span className="text-muted-foreground text-xs">
              <span aria-label="Attachments">📎</span> {attachmentCount}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
