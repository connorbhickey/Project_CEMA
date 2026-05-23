import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { communications } from './communications';

export interface CalendarAttendee {
  email: string;
  name: string | null;
  status: 'accepted' | 'declined' | 'tentative' | 'noreply';
}

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communicationId: uuid('communication_id')
      .notNull()
      .references(() => communications.id, { onDelete: 'restrict' }),
    nylasEventId: varchar('nylas_event_id', { length: 256 }).notNull(),
    nylasCalendarId: varchar('nylas_calendar_id', { length: 256 }).notNull(),
    nylasGrantId: varchar('nylas_grant_id', { length: 128 }).notNull(),
    title: text('title'),
    description: text('description'),
    location: text('location'),
    eventStatus: varchar('event_status', { length: 32 }).notNull().default('confirmed'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isAllDay: boolean('is_all_day').notNull().default(false),
    organizerEmail: varchar('organizer_email', { length: 256 }),
    organizerName: varchar('organizer_name', { length: 256 }),
    attendees: jsonb('attendees').$type<CalendarAttendee[]>().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('calendar_events_communication_id_uidx').on(t.communicationId),
    uniqueIndex('calendar_events_nylas_event_grant_uidx').on(t.nylasEventId, t.nylasGrantId),
    index('calendar_events_nylas_grant_id_idx').on(t.nylasGrantId),
    check(
      'calendar_events_status_valid',
      sql`${t.eventStatus} IN ('confirmed', 'tentative', 'cancelled')`,
    ),
  ],
);
