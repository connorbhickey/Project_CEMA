import { sql } from 'drizzle-orm';
import {
  check,
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
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { submissionMethodEnum } from './enums';

// ---------------------------------------------------------------------------
// EscalationContact — typed shape for escalation_path entries.
// Per spec §6.3: "escalation_path[] (rep names, supervisor emails)".
// ---------------------------------------------------------------------------
export interface EscalationContact {
  name: string;
  email: string;
  phone?: string;
  role?: string;
}

export const servicers = pgTable(
  'servicers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    legalName: text('legal_name').notNull(),
    dbaNames: jsonb('dba_names').$type<string[]>().default([]).notNull(),
    nmlsId: varchar('nmls_id', { length: 32 }),
    mersOrgId: varchar('mers_org_id', { length: 32 }),
    // Self-reference for parent-of (e.g., NewRez owns Shellpoint).
    // Default ON DELETE NO ACTION is intentional: the DB will reject
    // deleting a parent that still has children, preventing orphans.
    // Don't switch to SET NULL — losing the parent reference silently
    // would corrupt the playbook graph.
    parentServicerId: uuid('parent_servicer_id').references((): AnyPgColumn => servicers.id),
    collateralCustodian: text('collateral_custodian'),
    playbookVersion: integer('playbook_version').notNull().default(1),
    notes: text('notes'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('servicers_legal_name_idx').on(t.legalName),
    index('servicers_nmls_id_idx').on(t.nmlsId),
    check('servicers_playbook_version_positive', sql`${t.playbookVersion} >= 1`),
  ],
);

export const servicerCemaDepartments = pgTable(
  'servicer_cema_departments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    servicerId: uuid('servicer_id')
      .notNull()
      .references(() => servicers.id, { onDelete: 'cascade' }),
    phone: varchar('phone', { length: 32 }),
    fax: varchar('fax', { length: 32 }),
    email: varchar('email', { length: 255 }),
    portalUrl: text('portal_url'),
    acceptedSubmissionMethods: jsonb('accepted_submission_methods')
      .$type<Array<(typeof submissionMethodEnum.enumValues)[number]>>()
      .default([])
      .notNull(),
    typicalSlaBusinessDays: integer('typical_sla_business_days'),
    escalationPath: jsonb('escalation_path').$type<EscalationContact[]>().default([]).notNull(),
    commonRejectionReasons: jsonb('common_rejection_reasons')
      .$type<string[]>()
      .default([])
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    index('servicer_cema_departments_servicer_id_idx').on(t.servicerId),
    check(
      'servicer_cema_departments_sla_nonneg',
      sql`${t.typicalSlaBusinessDays} IS NULL OR ${t.typicalSlaBusinessDays} >= 0`,
    ),
  ],
);
