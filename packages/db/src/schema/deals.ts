import { sql } from 'drizzle-orm';
import {
  check,
  date,
  decimal,
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

import { cemaTypeEnum, dealStatusEnum, loanProgramEnum, propertyTypeEnum } from './enums.js';
import { servicers } from './servicers.js';
import { organizations, users } from './tenants.js';

// ---------------------------------------------------------------------------
// properties — NYC uses block+lot+acrisBbl; upstate uses taxMapId.
// ---------------------------------------------------------------------------
export const properties = pgTable(
  'properties',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    streetAddress: text('street_address').notNull(),
    unit: varchar('unit', { length: 32 }),
    city: text('city').notNull(),
    county: text('county').notNull(),
    zipCode: varchar('zip_code', { length: 16 }).notNull(),
    propertyType: propertyTypeEnum('property_type').notNull(),
    // NYC: block + lot identify a property on-record.
    block: varchar('block', { length: 32 }),
    lot: varchar('lot', { length: 32 }),
    // Upstate counties use a tax-map ID instead.
    taxMapId: varchar('tax_map_id', { length: 64 }),
    // ACRIS BBL = Borough-Block-Lot encoded as text (e.g. "1-00123-0045").
    // Drives automated ACRIS lookups in Phase 1.
    acrisBbl: varchar('acris_bbl', { length: 32 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // County is a hot filter (NYC vs upstate routing).
    index('properties_county_idx').on(t.county),
    // Partial index for ACRIS lookups — only populated for NYC properties.
    index('properties_acris_bbl_idx').on(t.acrisBbl),
  ],
);

// ---------------------------------------------------------------------------
// newLoans — the funding details for the incoming loan.
// ---------------------------------------------------------------------------
export const newLoans = pgTable(
  'new_loans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    principal: decimal('principal', { precision: 12, scale: 2 }).notNull(),
    rate: decimal('rate', { precision: 6, scale: 4 }),
    termMonths: integer('term_months'),
    program: loanProgramEnum('program').notNull(),
    targetFundingDate: date('target_funding_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // Numeric invariants — catch data-entry errors before they corrupt financials.
    check('new_loans_principal_positive', sql`${t.principal} > 0`),
    check('new_loans_term_months_positive', sql`${t.termMonths} IS NULL OR ${t.termMonths} > 0`),
    check('new_loans_rate_nonneg', sql`${t.rate} IS NULL OR ${t.rate} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// deals — the CENTRAL entity. Every screen, agent, and document is a view
// over a Deal. Multi-tenant: always scoped to an organization.
// ---------------------------------------------------------------------------
export const deals = pgTable(
  'deals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // onDelete: 'restrict' because organizations use soft-delete (deleted_at),
    // never hard-delete. Cascade would be wrong — restrict catches bugs.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    cemaType: cemaTypeEnum('cema_type').notNull(),
    status: dealStatusEnum('status').notNull().default('intake'),
    // Nullable: property may be added after initial intake.
    // No explicit onDelete: properties are deal-owned; default no-action
    // is intentional — a property row shouldn't disappear under a deal.
    propertyId: uuid('property_id').references(() => properties.id),
    // Nullable: new loan details entered as deal matures.
    newLoanId: uuid('new_loan_id').references(() => newLoans.id),
    // onDelete: 'restrict' because users use soft-delete (deleted_at).
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    // SLA and lifecycle timestamps.
    targetCloseAt: timestamp('target_close_at', { withTimezone: true }),
    slaBreachAt: timestamp('sla_breach_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // RLS-friendly composite index: org-scoped lookup by id.
    // Postgres RLS policies typically filter by organization_id first.
    uniqueIndex('deals_org_id_id_idx').on(t.organizationId, t.id),
    // Standalone FK indexes — Postgres does NOT auto-create indexes on FK columns.
    index('deals_organization_id_idx').on(t.organizationId),
    index('deals_property_id_idx').on(t.propertyId),
    index('deals_new_loan_id_idx').on(t.newLoanId),
    index('deals_created_by_id_idx').on(t.createdById),
    // Status is the primary filter on the pipeline kanban view.
    index('deals_status_idx').on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// existingLoans — the prior-mortgage chain being consolidated.
// chain_position=0 is the oldest (earliest) mortgage; higher = more recent.
// Multiple existing_loans per deal form the Schedule A consolidation list.
// ---------------------------------------------------------------------------
export const existingLoans = pgTable(
  'existing_loans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Cascade: existing_loans are owned by a deal. If a deal is hard-deleted
    // (edge case — most deletions are status transitions), existing_loans follow.
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    // UPB = Unpaid Principal Balance — the tax-exempt portion under §255.
    upb: decimal('upb', { precision: 12, scale: 2 }).notNull(),
    originalPrincipal: decimal('original_principal', { precision: 12, scale: 2 }),
    noteDate: date('note_date'),
    maturityDate: date('maturity_date'),
    // Nullable: servicer may not be identified at intake.
    // Default no-action: servicers are global entities; losing a servicer
    // reference should be blocked at the servicer level, not silently cleared.
    currentServicerId: uuid('current_servicer_id').references(() => servicers.id),
    // Fannie / Freddie / MERS / private label investor identifier.
    investor: varchar('investor', { length: 64 }),
    // Recording coordinates: upstate reel/page or NYC CRFN (mutually exclusive
    // in practice, but both stored for flexibility).
    recordedReelPage: varchar('recorded_reel_page', { length: 64 }),
    recordedCrfn: varchar('recorded_crfn', { length: 64 }),
    // Position in the consolidation chain (0 = oldest, n-1 = most recent).
    chainPosition: integer('chain_position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // FK indexes — Postgres does NOT auto-create.
    index('existing_loans_deal_id_idx').on(t.dealId),
    index('existing_loans_current_servicer_id_idx').on(t.currentServicerId),
    // Numeric invariants — UPB drives tax-savings calculation; must be valid.
    check('existing_loans_upb_nonneg', sql`${t.upb} >= 0`),
    check('existing_loans_chain_position_nonneg', sql`${t.chainPosition} >= 0`),
    check(
      'existing_loans_original_principal_positive',
      sql`${t.originalPrincipal} IS NULL OR ${t.originalPrincipal} > 0`,
    ),
  ],
);
