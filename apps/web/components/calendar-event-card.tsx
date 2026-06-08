import type { calendarEvents, communications } from '@cema/db';
import Link from 'next/link';

import { routeHref } from '@/lib/routes';

type Communication = typeof communications.$inferSelect;
type CalendarEvent = typeof calendarEvents.$inferSelect;

interface CalendarEventCardProps {
  communication: Communication;
  calendarEvent: CalendarEvent | null;
  dealId: string;
}

const STATUS_COLOR: Record<string, string> = {
  confirmed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  tentative: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  cancelled: 'bg-red-500/10 text-red-700 dark:text-red-400',
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
      href={routeHref(`/deals/${dealId}/communications/${communication.id}`)}
      className="bg-card border-border hover:bg-accent/40 block rounded-xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05)] transition-colors"
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
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
              STATUS_COLOR[status] ?? 'bg-slate-400/10 text-slate-600 dark:text-slate-400'
            }`}
          >
            {status}
          </span>
          <span className="rounded-full bg-slate-400/10 px-2 py-0.5 text-[11px] font-semibold capitalize text-slate-600 dark:text-slate-400">
            {communication.medium}
          </span>
        </div>
      </div>
    </Link>
  );
}
