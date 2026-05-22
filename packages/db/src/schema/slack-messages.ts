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

export const slackMessages = pgTable(
  'slack_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communicationId: uuid('communication_id')
      .notNull()
      .references(() => communications.id, { onDelete: 'restrict' }),
    slackTeamId: varchar('slack_team_id', { length: 32 }).notNull(),
    slackChannelId: varchar('slack_channel_id', { length: 32 }).notNull(),
    slackChannelName: varchar('slack_channel_name', { length: 128 }),
    slackMessageTs: varchar('slack_message_ts', { length: 32 }).notNull(),
    slackThreadTs: varchar('slack_thread_ts', { length: 32 }),
    authorSlackUserId: varchar('author_slack_user_id', { length: 32 }),
    authorDisplayName: varchar('author_display_name', { length: 128 }),
    text: text('text'),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().default({}).notNull(),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    messageType: varchar('message_type', { length: 32 }).notNull().default('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('slack_messages_communication_id_uidx').on(t.communicationId),
    uniqueIndex('slack_messages_channel_ts_uidx').on(
      t.slackTeamId,
      t.slackChannelId,
      t.slackMessageTs,
    ),
    index('slack_messages_team_channel_idx').on(t.slackTeamId, t.slackChannelId),
    index('slack_messages_thread_idx').on(t.slackThreadTs),
    check(
      'slack_messages_type_valid',
      sql`${t.messageType} IN ('message', 'app_mention', 'thread_reply')`,
    ),
  ],
);
