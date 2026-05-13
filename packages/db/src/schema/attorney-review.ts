import {
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

import { documents } from './documents.js';
import { users } from './tenants.js';

// ---------------------------------------------------------------------------
// attorneyApprovals — immutable records of attorney approval per document version.
//
// Hard rule #2: Documents with attorney_review_required = true MUST NOT be
// marked 'executed' or 'recorded' without a corresponding AttorneyApproval
// event. This table is that event store.
//
// Intentionally NO updatedAt: approval records are immutable. A new version
// of a document requires a new approval row. Never UPDATE or DELETE these rows.
// Tampering with this table is treated as an audit incident.
// ---------------------------------------------------------------------------
export const attorneyApprovals = pgTable(
  'attorney_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Cascade: approvals are scoped to a specific document.
    // If a document is hard-deleted (unusual — most transitions are status changes),
    // approvals follow it.
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // Snapshot the version at time of approval — ensures the approval is
    // precisely traceable to the document version shown to the attorney.
    documentVersion: integer('document_version').notNull(),
    // Restrict: users use soft-delete (deleted_at). Do not cascade — losing a
    // user reference on an approval would silently corrupt the attorney trail.
    approvedById: uuid('approved_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }).defaultNow().notNull(),
    // NMLS ID of the supervising attorney (required for compliance audit).
    nmlsId: varchar('nmls_id', { length: 32 }),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  },
  (t) => [
    index('attorney_approvals_document_id_idx').on(t.documentId),
    index('attorney_approvals_approved_by_id_idx').on(t.approvedById),
    // Prevent double-approval race conditions: a given document version can only
    // ever have one approval row. A new document version requires a new approval.
    uniqueIndex('attorney_approvals_doc_version_uidx').on(t.documentId, t.documentVersion),
  ],
);
