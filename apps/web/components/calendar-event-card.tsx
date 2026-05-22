import type { calendarEvents, communications } from '@cema/db';
import type { Route } from 'next';
import Link from 'next/link';

type Communication = typeof communications.$inferSelect;
type CalendarEvent = typeof calendarEvents.$inferSelect;

interface CalendarEventCardProps {
  communication: Communication;
  calendarEvent: CalendarEvent | null;
  dealId: string;
}

const STATUS_COLOR: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700',
  tentative: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
};

function formatDateRange(start: Date | null | undefined, end: Date | null | undefined): string {
  if (!start) return '—';
  const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  if (!end) return fmt.format(start);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    const timeFmt = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' });
    return `${fmt.format(start)} – ${timeFmt.format(end)}`;
  }
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function CalendarEventCard({
  communication,
  calendarEvent,
  dealId,
}: CalendarEventCardProps) {
  const status = calendarEvent?.eventStatus ?? 'confirmed';
  const attendeeCount = calendarEvent?.attendees?.length ?? 0;

  return (
    <Link
      href={`/deals/${dealId}/communications/${communication.id}` as Route}
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-label="Calendar event" className="text-muted-foreground text-xs">
              📅
            </span>
            <p className="truncate text-sm font-medium">
              {calendarEvent?.title ?? '(untitled event)'}
            </p>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {formatDateRange(communication.startedAt, communication.endedAt)}
          </p>
          {calendarEvent?.location ? (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              <span aria-label="Location">📍</span> {calendarEvent.location}
            </p>
          ) : null}
          {attendeeCount > 0 ? (
            <p className="text-muted-foreground mt-0.5 text-xs">{attendeeCount} attendees</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
              STATUS_COLOR[status] ?? 'bg-gray-100 text-gray-600'
            }`}
          >
            {status}
          </span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
            {communication.medium}
          </span>
        </div>
      </div>
    </Link>
  );
}
