import type { communications, slackMessages } from '@cema/db';
import Link from 'next/link';

import { routeHref } from '@/lib/routes';

type Communication = typeof communications.$inferSelect;
type SlackMessage = typeof slackMessages.$inferSelect;

interface SlackMessageCardProps {
  communication: Communication;
  slackMessage: SlackMessage | null;
  dealId: string;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const TYPE_BADGE: Record<string, string> = {
  message: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  app_mention: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  thread_reply: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
};

export function SlackMessageCard({ communication, slackMessage, dealId }: SlackMessageCardProps) {
  const author = slackMessage?.authorDisplayName ?? slackMessage?.authorSlackUserId ?? '—';
  const channel = slackMessage?.slackChannelName ?? slackMessage?.slackChannelId ?? '—';
  const type = slackMessage?.messageType ?? 'message';

  return (
    <Link
      href={routeHref(`/deals/${dealId}/communications/${communication.id}`)}
      className="bg-card border-border hover:bg-accent/40 block rounded-xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05)] transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-label="Slack" className="text-muted-foreground text-xs">
              💬
            </span>
            <p className="truncate text-sm font-medium">
              {author} <span className="text-muted-foreground">in #{channel}</span>
            </p>
          </div>
          {slackMessage?.text ? (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{slackMessage.text}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="text-muted-foreground text-xs">{formatDate(communication.startedAt)}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_BADGE[type] ?? 'bg-slate-400/10 text-slate-600 dark:text-slate-400'}`}
          >
            {type.replace('_', ' ')}
          </span>
          {slackMessage?.hasAttachments ? (
            <span className="text-muted-foreground text-xs">📎</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
