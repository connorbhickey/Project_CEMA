import type { communications, emailThreads } from '@cema/db';
import Link from 'next/link';

import { routeHref } from '@/lib/routes';

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
      href={routeHref(`/deals/${dealId}/communications/${communication.id}`)}
      className="bg-card border-border hover:bg-accent/40 block rounded-xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05)] transition-colors"
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
          <span className="rounded-full bg-slate-400/10 px-2 py-0.5 text-[11px] font-semibold capitalize text-slate-600 dark:text-slate-400">
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
