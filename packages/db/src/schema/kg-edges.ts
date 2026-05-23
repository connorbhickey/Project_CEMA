import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './tenants';

// ---------------------------------------------------------------------------
// kg_edges — directed edges in the contact ↔ party ↔ deal knowledge graph
// (M6 replacement for Apache AGE — same semantics, pure Postgres).
//
// NodeType values: 'contact' | 'party' | 'deal' | 'document' | 'communication'
// Predicate values: 'contact_is_party' | 'party_is_on_deal' | 'deal_has_document'
//
// Traversal uses WITH RECURSIVE CTEs — see @cema/kg.
// ---------------------------------------------------------------------------
export const kgEdges = pgTable(
  'kg_edges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').notNull(),
    subjectType: text('subject_type').notNull(),
    predicate: text('predicate').notNull(),
    objectId: uuid('object_id').notNull(),
    objectType: text('object_type').notNull(),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('kg_edges_uidx').on(
      t.organizationId,
      t.subjectId,
      t.subjectType,
      t.predicate,
      t.objectId,
      t.objectType,
    ),
    index('kg_edges_subject_idx').on(t.organizationId, t.subjectId, t.subjectType),
    index('kg_edges_object_idx').on(t.organizationId, t.objectId, t.objectType),
  ],
);
