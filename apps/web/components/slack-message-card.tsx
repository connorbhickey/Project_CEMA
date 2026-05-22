import type { communications, slackMessages } from '@cema/db';
import type { Route } from 'next';
import Link from 'next/link';

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
  message: 'bg-purple-100 text-purple-700',
  app_mention: 'bg-orange-100 text-orange-700',
  thread_reply: 'bg-blue-100 text-blue-700',
};

export function SlackMessageCard({ communication, slackMessage, dealId }: SlackMessageCardProps) {
  const author = slackMessage?.authorDisplayName ?? slackMessage?.authorSlackUserId ?? '—';
  const channel = slackMessage?.slackChannelName ?? slackMessage?.slackChannelId ?? '—';
  const type = slackMessage?.messageType ?? 'message';

  return (
    <Link
      href={`/deals/${dealId}/communications/${communication.id}` as Route}
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
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
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[type] ?? 'bg-gray-100 text-gray-600'}`}
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
