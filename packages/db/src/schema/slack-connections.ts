import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { organizations, users } from './tenants';

export const orgSlackConnections = pgTable(
  'org_slack_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    slackTeamId: varchar('slack_team_id', { length: 32 }).notNull(),
    slackTeamName: varchar('slack_team_name', { length: 256 }),
    slackBotToken: text('slack_bot_token').notNull(),
    slackBotUserId: varchar('slack_bot_user_id', { length: 32 }),
    connectionStatus: varchar('connection_status', { length: 32 }).notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('org_slack_connections_team_uidx').on(t.slackTeamId),
    uniqueIndex('org_slack_connections_org_team_uidx').on(t.organizationId, t.slackTeamId),
    index('org_slack_connections_org_id_idx').on(t.organizationId),
    check(
      'org_slack_connections_status_valid',
      sql`${t.connectionStatus} IN ('active', 'error', 'revoked')`,
    ),
    check(
      'org_slack_connections_revoked_at_required',
      sql`(${t.connectionStatus} = 'revoked' AND ${t.revokedAt} IS NOT NULL) OR (${t.connectionStatus} <> 'revoked' AND ${t.revokedAt} IS NULL)`,
    ),
    check('org_slack_connections_bot_token_prefix', sql`${t.slackBotToken} LIKE 'xoxb-%'`),
  ],
);
