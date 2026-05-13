import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { deals } from './deals.js';
import { documentKindEnum, documentStatusEnum } from './enums.js';

// ---------------------------------------------------------------------------
// documents — every PDF/file the deal touches.
//
// Hard rule #2: Documents with kind ∈ {cema_3172, exhibit_*, gap_note,
// gap_mortgage, consolidated_note, aom, allonge, aff_255, aff_275, mt_15,
// county_cover_sheet} MUST have attorney_review_required = true and MUST NOT
// be marked 'executed' or 'recorded' without an AttorneyApproval event.
// Schema enforces the gate via the boolean; runtime enforcement is in Task 11's
// requireAttorneyApproval guard.
// ---------------------------------------------------------------------------
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Documents are owned by a deal — cascade if a deal is hard-deleted.
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    kind: documentKindEnum('kind').notNull(),
    status: documentStatusEnum('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    // Hard rule #2: gate boolean. Must be true for attorney-review-required kinds.
    // Runtime guard (requireAttorneyApproval) lives in packages/compliance (Task 11).
    attorneyReviewRequired: boolean('attorney_review_required').notNull().default(false),
    blobUrl: text('blob_url'),
    checksum: varchar('checksum', { length: 128 }),
    pageCount: integer('page_count'),
    // IDP-extracted data stored alongside the blob (Reducto / Textract output).
    extractedData: jsonb('extracted_data').$type<Record<string, unknown>>().default({}).notNull(),
    // Recording identifiers: upstate reel/page OR NYC CRFN — mutually exclusive.
    // Hard rule #6: MUST NOT be marked 'recorded' without one of these present
    // (runtime enforcement in Task 11; schema captures the columns).
    recordedReelPage: varchar('recorded_reel_page', { length: 64 }),
    recordedCrfn: varchar('recorded_crfn', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    index('documents_deal_id_idx').on(t.dealId),
    index('documents_kind_idx').on(t.kind),
    index('documents_status_idx').on(t.status),
    // version must be a positive integer — prevent version=0 or negative drift.
    check('documents_version_positive', sql`${t.version} >= 1`),
    check('documents_page_count_positive', sql`${t.pageCount} IS NULL OR ${t.pageCount} > 0`),
    // Reel/page (upstate) and CRFN (NYC) are mutually exclusive recording identifiers.
    check(
      'documents_recording_xor',
      sql`NOT (${t.recordedReelPage} IS NOT NULL AND ${t.recordedCrfn} IS NOT NULL)`,
    ),
  ],
);
