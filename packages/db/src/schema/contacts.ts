import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { vector3072 } from './communications';
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
    // pgvector embedding of the contact's name/employer/email for FUZZY dedup
    // (spec §9.1). 3072-dim (text-embedding-3-large); brute-force cosine scan
    // scoped to one org (no HNSW index — pgvector can't index > 2000 dims, and an
    // org's contact count is small). Nullable: backfilled lazily, gated on the
    // OpenAI key — exact email/phone dedup works without it.
    embedding: vector3072('embedding'),
    embeddingGeneratedAt: timestamp('embedding_generated_at', { withTimezone: true }),
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
    // Composite-FK target: lets contact_identities reference (id, organization_id)
    // together so an identity's org MUST match its contact's org (tenancy guard).
    unique('contacts_id_organization_id_key').on(t.id, t.organizationId),
  ],
);

export const contactIdentities = pgTable(
  'contact_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // contactId's FK is the COMPOSITE (contact_id, organization_id) one below, not
    // a standalone reference — that's what couples the identity's org to the
    // contact's org. Kept notNull here; the reference lives in the table config.
    contactId: uuid('contact_id').notNull(),
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
    // Org-integrity: (contact_id, organization_id) must be a real pair in contacts,
    // so an identity can never reference a contact in a DIFFERENT org (RLS scopes
    // by organization_id, so a mismatch would be a cross-tenant leak). Replaces the
    // old single-column contact_id FK; cascade preserves delete-with-contact.
    foreignKey({
      columns: [t.contactId, t.organizationId],
      foreignColumns: [contacts.id, contacts.organizationId],
      name: 'contact_identities_contact_org_fk',
    }).onDelete('cascade'),
  ],
);
