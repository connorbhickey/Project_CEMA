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

export const orgDocusignConnections = pgTable(
  'org_docusign_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    docusignAccountId: varchar('docusign_account_id', { length: 64 }).notNull(),
    docusignBaseUrl: varchar('docusign_base_url', { length: 256 }).notNull(),
    docusignUserId: varchar('docusign_user_id', { length: 64 }),
    integrationKey: varchar('integration_key', { length: 128 }).notNull(),
    rsaPrivateKey: text('rsa_private_key').notNull(),
    connectSecret: text('connect_secret').notNull(),
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
    uniqueIndex('org_docusign_connections_account_uidx').on(t.docusignAccountId),
    uniqueIndex('org_docusign_connections_org_account_uidx').on(
      t.organizationId,
      t.docusignAccountId,
    ),
    index('org_docusign_connections_org_id_idx').on(t.organizationId),
    index('org_docusign_connections_org_status_idx').on(t.organizationId, t.connectionStatus),
    check(
      'org_docusign_connections_status_valid',
      sql`${t.connectionStatus} IN ('active', 'error', 'revoked')`,
    ),
    check(
      'org_docusign_connections_revoked_at_required',
      sql`(${t.connectionStatus} = 'revoked' AND ${t.revokedAt} IS NOT NULL) OR (${t.connectionStatus} <> 'revoked' AND ${t.revokedAt} IS NULL)`,
    ),
  ],
);
