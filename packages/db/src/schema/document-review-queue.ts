import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { documents } from './documents';
import { documentReviewStateEnum } from './enums';
import { organizations, users } from './tenants';

// ---------------------------------------------------------------------------
// document_review_queue — attorney review workflow queue (M5 task 13).
//
// Every document with attorney_review_required = true must pass through this
// queue before it can be sent via DocuSign (sendEnvelope) or marked executed.
//
// State machine: pending → claimed → approved | rejected
//               claimed → pending  (unclaim / release back to pool)
// Terminal states: approved, rejected.
//
// One active queue row per (document_id, document_version) — idempotent
// submitForReview returns the existing row if one already exists.
// ---------------------------------------------------------------------------
export const documentReviewQueue = pgTable(
  'document_review_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    documentVersion: integer('document_version').notNull(),
    submittedById: uuid('submitted_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    state: documentReviewStateEnum('state').notNull().default('pending'),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // Only one active queue row per (document_id, document_version).
    uniqueIndex('document_review_queue_doc_version_uidx').on(t.documentId, t.documentVersion),
    // Fast lookup: all pending/claimed items for an org (attorney inbox query).
    index('document_review_queue_org_state_idx').on(t.organizationId, t.state),
    // Fast lookup: items claimed by a reviewer.
    index('document_review_queue_reviewer_idx').on(t.reviewerId),
    // decided_at is only set once the state reaches a terminal value.
    check(
      'document_review_queue_decided_at_requires_terminal_state',
      sql`(${t.decidedAt} IS NULL) OR (${t.state} IN ('approved', 'rejected'))`,
    ),
    // rejection_reason is only meaningful on rejected rows.
    check(
      'document_review_queue_rejection_reason_requires_reject',
      sql`(${t.rejectionReason} IS NULL) OR (${t.state} = 'rejected')`,
    ),
  ],
);
