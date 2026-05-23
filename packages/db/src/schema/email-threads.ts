import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { communications } from './communications';

export interface EmailParticipant {
  email: string;
  name: string | null;
}

export const emailThreads = pgTable(
  'email_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communicationId: uuid('communication_id')
      .notNull()
      .references(() => communications.id, { onDelete: 'restrict' }),
    nylasThreadId: varchar('nylas_thread_id', { length: 256 }).notNull(),
    nylasGrantId: varchar('nylas_grant_id', { length: 128 }).notNull(),
    subject: text('subject'),
    snippet: text('snippet'),
    fromEmail: varchar('from_email', { length: 256 }),
    fromName: varchar('from_name', { length: 256 }),
    toParticipants: jsonb('to_participants').$type<EmailParticipant[]>().default([]).notNull(),
    ccParticipants: jsonb('cc_participants').$type<EmailParticipant[]>().default([]).notNull(),
    bodyHtml: text('body_html'),
    bodyPlain: text('body_plain'),
    messageCount: integer('message_count').notNull().default(1),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    nylasAttachmentIds: jsonb('nylas_attachment_ids').$type<string[]>().default([]).notNull(),
    firstMessageAt: timestamp('first_message_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('email_threads_communication_id_uidx').on(t.communicationId),
    uniqueIndex('email_threads_nylas_thread_id_grant_uidx').on(t.nylasThreadId, t.nylasGrantId),
    index('email_threads_nylas_grant_id_idx').on(t.nylasGrantId),
    check('email_threads_message_count_pos', sql`${t.messageCount} >= 1`),
  ],
);
