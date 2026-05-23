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

export const orgDriveConnections = pgTable(
  'org_drive_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    googleAccountEmail: varchar('google_account_email', { length: 256 }).notNull(),
    googleAccountId: varchar('google_account_id', { length: 128 }),
    oauthRefreshToken: text('oauth_refresh_token').notNull(),
    driveChannelId: varchar('drive_channel_id', { length: 128 }),
    driveChannelToken: varchar('drive_channel_token', { length: 128 }),
    driveChannelExpiresAt: timestamp('drive_channel_expires_at', { withTimezone: true }),
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
    uniqueIndex('org_drive_connections_channel_id_uidx').on(t.driveChannelId),
    uniqueIndex('org_drive_connections_org_email_uidx').on(t.organizationId, t.googleAccountEmail),
    index('org_drive_connections_org_id_idx').on(t.organizationId),
    index('org_drive_connections_org_status_idx').on(t.organizationId, t.connectionStatus),
    check(
      'org_drive_connections_status_valid',
      sql`${t.connectionStatus} IN ('active', 'error', 'revoked')`,
    ),
    check(
      'org_drive_connections_revoked_at_required',
      sql`(${t.connectionStatus} = 'revoked' AND ${t.revokedAt} IS NOT NULL) OR (${t.connectionStatus} <> 'revoked' AND ${t.revokedAt} IS NULL)`,
    ),
  ],
);
