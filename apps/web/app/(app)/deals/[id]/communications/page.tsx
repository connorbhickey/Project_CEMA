import type { communications } from '@cema/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CalendarEventCard } from '@/components/calendar-event-card';
import { CommunicationCard } from '@/components/communication-card';
import { EmailThreadCard } from '@/components/email-thread-card';
import { listCalendarEvents } from '@/lib/actions/list-calendar-events';
import { listCommunications } from '@/lib/actions/list-communications';
import { listEmails } from '@/lib/actions/list-emails';

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

type TimelineItem = CallItem | EmailItem | MeetingItem;

function sortKey(date: Date | null): number {
  return date?.getTime() ?? 0;
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;

  const [calls, emails, meetings] = await Promise.all([
    listCommunications(dealId),
    listEmails(dealId),
    listCalendarEvents(dealId),
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
  ].sort((a, b) => b.sortKey - a.sortKey);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Communications</h1>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No communications yet</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Calls, emails, and meetings linked to this deal will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" role="list" aria-label="Communications list">
          {items.map((item) => {
            if (item.kind === 'call') {
              return (
                <li key={item.call.id}>
                  <Link href={`/deals/${dealId}/communications/${item.call.id}`} className="block">
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
    </div>
  );
}
