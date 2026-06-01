import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { deals } from './deals';
import { documents } from './documents';
import { chainBreakReviewStateEnum } from './enums';
import { organizations, users } from './tenants';

// ---------------------------------------------------------------------------
// chain_break_review_queue — Chain-of-Title Tier 2 attorney review queue (M14).
//
// One row per attorney-routed chain break (lost_note, ambiguous_assignment,
// unrecorded_instrument). re_chase breaks are NOT stored here — they hand off
// to the Servicer Outreach Agent via the collateral pipeline.
//
// State machine (packages/attorney/src/chain-break-state.ts):
//   pending → claimed → resolved | dismissed   (claimed → pending releases)
// Terminal states: resolved, dismissed.
//
// One row per (deal_id, break_hash) — the idempotent-enqueue key from the
// openAttorneyReview actuator. break_hash is the deterministic PII-safe id from
// apps/web/lib/agents/chain-of-title/break-hash.ts. reason is the static
// PII-free RouteDecision.reason; resolution_note is attorney free-text that MAY
// carry PII (hard rule #3) and must never be logged or audited.
// ---------------------------------------------------------------------------
export const chainBreakReviewQueue = pgTable(
  'chain_break_review_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'restrict' }),
    breakHash: text('break_hash').notNull(),
    breakKind: text('break_kind').notNull(),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    state: chainBreakReviewStateEnum('state').notNull().default('pending'),
    submittedById: uuid('submitted_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // One active row per break — the idempotent-enqueue key.
    uniqueIndex('chain_break_review_queue_deal_break_uidx').on(t.dealId, t.breakHash),
    // Fast lookup: all pending/claimed items for an org (future attorney inbox).
    index('chain_break_review_queue_org_state_idx').on(t.organizationId, t.state),
    // Fast lookup: items claimed by a reviewer.
    index('chain_break_review_queue_reviewer_idx').on(t.reviewerId),
    // decided_at is only set once the state reaches a terminal value.
    check(
      'chain_break_review_queue_decided_at_requires_terminal',
      sql`(${t.decidedAt} IS NULL) OR (${t.state} IN ('resolved', 'dismissed'))`,
    ),
    // resolution_note is only meaningful on a terminal (resolved/dismissed) row.
    check(
      'chain_break_review_queue_resolution_note_requires_terminal',
      sql`(${t.resolutionNote} IS NULL) OR (${t.state} IN ('resolved', 'dismissed'))`,
    ),
    // Defense-in-depth (mirrors documents_attorney_gate_required): only
    // attorney-routed breaks land here. missing_assignment routes to re_chase,
    // never to this queue — catch a routing regression at the DB boundary.
    // This literal set is kept in lockstep with @cema/agents-chain-of-title's
    // route() by the drift guard in that package's route.test.ts ("attorney-routed
    // break kinds match the chain_break_review_queue CHECK") — @cema/db cannot
    // import the agent package, so the test is the cross-package contract.
    check(
      'chain_break_review_queue_break_kind_is_attorney_routed',
      sql`${t.breakKind} IN ('lost_note', 'ambiguous_assignment', 'unrecorded_instrument')`,
    ),
  ],
);
