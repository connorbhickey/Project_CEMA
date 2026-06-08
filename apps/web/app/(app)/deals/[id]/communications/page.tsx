import type { communications } from '@cema/db';
import { MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CalendarEventCard } from '@/components/calendar-event-card';
import { CommunicationCard } from '@/components/communication-card';
import { BentoCard } from '@/components/deal-hub/bento-card';
import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
import { EmailThreadCard } from '@/components/email-thread-card';
import { SlackMessageCard } from '@/components/slack-message-card';
import { listCalendarEvents } from '@/lib/actions/list-calendar-events';
import { listCommunications } from '@/lib/actions/list-communications';
import { listEmails } from '@/lib/actions/list-emails';
import { listSlackMessages } from '@/lib/actions/list-slack-messages';
import { routeHref } from '@/lib/routes';

type Communication = typeof communications.$inferSelect;

interface CallItem {
  kind: 'call';
  sortKey: number;
  call: Communication;
}
interface EmailItem {
  kind: 'email';
  sortKey: number;
  communication: Communication;
  emailThread: Awaited<ReturnType<typeof listEmails>>[number]['emailThread'];
}
interface MeetingItem {
  kind: 'meeting';
  sortKey: number;
  communication: Communication;
  calendarEvent: Awaited<ReturnType<typeof listCalendarEvents>>[number]['calendarEvent'];
}
interface SlackItem {
  kind: 'slack';
  sortKey: number;
  communication: Communication;
  slackMessage: Awaited<ReturnType<typeof listSlackMessages>>[number]['slackMessage'];
}

type TimelineItem = CallItem | EmailItem | MeetingItem | SlackItem;

function sortKey(date: Date | null): number {
  return date?.getTime() ?? 0;
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;

  const [calls, emails, meetings, slacks] = await Promise.all([
    listCommunications(dealId),
    listEmails(dealId),
    listCalendarEvents(dealId),
    listSlackMessages(dealId),
  ]);

  if (calls === null) notFound();

  const items: TimelineItem[] = [
    ...calls.map<CallItem>((c) => ({
      kind: 'call',
      sortKey: sortKey(c.startedAt),
      call: c,
    })),
    ...emails.map<EmailItem>((row) => ({
      kind: 'email',
      sortKey: sortKey(row.communication.startedAt),
      communication: row.communication,
      emailThread: row.emailThread,
    })),
    ...meetings.map<MeetingItem>((row) => ({
      kind: 'meeting',
      sortKey: sortKey(row.communication.startedAt),
      communication: row.communication,
      calendarEvent: row.calendarEvent,
    })),
    ...slacks.map<SlackItem>((row) => ({
      kind: 'slack',
      sortKey: sortKey(row.communication.startedAt),
      communication: row.communication,
      slackMessage: row.slackMessage,
    })),
  ].sort((a, b) => b.sortKey - a.sortKey);

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={dealId} active={null} />

      <BentoCard
        icon={
          <MessagesSquare className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />
        }
        iconTile="bg-teal-500/10"
        title="Communications"
      >
        <div className="mb-2">
          <h2 className="text-foreground mb-1 text-lg font-bold tracking-tight">Communications</h2>
          <p className="text-muted-foreground text-[13px]">
            Calls, emails, meetings, and Slack messages linked to this deal.
          </p>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="bg-muted mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
              <MessagesSquare
                className="h-6 w-6 text-teal-600 dark:text-teal-400"
                strokeWidth={1.5}
              />
            </div>
            <p className="text-foreground text-sm font-semibold">No communications yet</p>
            <p className="text-muted-foreground mt-1 text-[12.5px]">
              Calls, emails, meetings, and Slack messages linked to this deal will appear here.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3" role="list" aria-label="Communications list">
            {items.map((item) => {
              if (item.kind === 'call') {
                return (
                  <li key={item.call.id}>
                    <Link
                      href={routeHref(`/deals/${dealId}/communications/${item.call.id}`)}
                      className="block"
                    >
                      <CommunicationCard comm={item.call} />
                    </Link>
                  </li>
                );
              }
              if (item.kind === 'email') {
                return (
                  <li key={item.communication.id}>
                    <EmailThreadCard
                      communication={item.communication}
                      emailThread={item.emailThread}
                      dealId={dealId}
                    />
                  </li>
                );
              }
              if (item.kind === 'slack') {
                return (
                  <li key={item.communication.id}>
                    <SlackMessageCard
                      communication={item.communication}
                      slackMessage={item.slackMessage}
                      dealId={dealId}
                    />
                  </li>
                );
              }
              return (
                <li key={item.communication.id}>
                  <CalendarEventCard
                    communication={item.communication}
                    calendarEvent={item.calendarEvent}
                    dealId={dealId}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </BentoCard>
    </div>
  );
}
