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

export const orgNylasConnections = pgTable(
  'org_nylas_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    providerType: varchar('provider_type', { length: 32 }).notNull(),
    nylasGrantId: varchar('nylas_grant_id', { length: 128 }).notNull(),
    emailAddress: varchar('email_address', { length: 256 }).notNull(),
    connectionStatus: varchar('connection_status', { length: 32 }).notNull().default('pending'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('org_nylas_connections_grant_id_uidx').on(t.nylasGrantId),
    uniqueIndex('org_nylas_connections_org_provider_email_uidx').on(
      t.organizationId,
      t.providerType,
      t.emailAddress,
    ),
    index('org_nylas_connections_org_status_idx').on(t.organizationId, t.connectionStatus),
    index('org_nylas_connections_organization_id_idx').on(t.organizationId),
    check(
      'org_nylas_connections_status_valid',
      sql`${t.connectionStatus} IN ('pending', 'active', 'error', 'revoked')`,
    ),
    check('org_nylas_connections_provider_valid', sql`${t.providerType} IN ('gmail', 'm365')`),
    check(
      'org_nylas_connections_revoked_at_required',
      sql`(${t.connectionStatus} = 'revoked' AND ${t.revokedAt} IS NOT NULL) OR (${t.connectionStatus} <> 'revoked' AND ${t.revokedAt} IS NULL)`,
    ),
  ],
);
