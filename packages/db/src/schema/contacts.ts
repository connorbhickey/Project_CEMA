import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { organizations } from './tenants';

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    primaryName: text('primary_name'),
    primaryEmail: varchar('primary_email', { length: 256 }),
    primaryPhone: varchar('primary_phone', { length: 20 }),
    employer: varchar('employer', { length: 256 }),
    role: varchar('role', { length: 64 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    index('contacts_organization_id_idx').on(t.organizationId),
    index('contacts_primary_email_idx').on(t.organizationId, t.primaryEmail),
    index('contacts_primary_phone_idx').on(t.organizationId, t.primaryPhone),
  ],
);

export const contactIdentities = pgTable(
  'contact_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    normalizedValue: varchar('normalized_value', { length: 256 }).notNull(),
    rawValue: varchar('raw_value', { length: 256 }),
    source: varchar('source', { length: 32 }).notNull(),
    sourceId: uuid('source_id'),
    confidence: doublePrecision('confidence').notNull().default(1.0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('contact_identities_org_kind_value_uidx').on(
      t.organizationId,
      t.kind,
      t.normalizedValue,
    ),
    index('contact_identities_contact_id_idx').on(t.contactId),
    index('contact_identities_organization_id_idx').on(t.organizationId),
    check(
      'contact_identities_kind_valid',
      sql`${t.kind} IN ('email', 'phone', 'slack_user', 'crm_id')`,
    ),
    check(
      'contact_identities_source_valid',
      sql`${t.source} IN ('party', 'comm_from', 'comm_to', 'slack_message', 'manual')`,
    ),
    check(
      'contact_identities_confidence_range',
      sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`,
    ),
  ],
);
