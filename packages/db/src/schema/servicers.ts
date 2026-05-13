import { sql } from 'drizzle-orm';
import {
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

import type { submissionMethodEnum } from './enums.js';

export const servicers = pgTable(
  'servicers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    legalName: text('legal_name').notNull(),
    dbaNames: jsonb('dba_names').$type<string[]>().default([]).notNull(),
    nmlsId: varchar('nmls_id', { length: 32 }),
    mersOrgId: varchar('mers_org_id', { length: 32 }),
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
  (t) => [uniqueIndex('servicers_legal_name_idx').on(t.legalName)],
);

export const servicerCemaDepartments = pgTable('servicer_cema_departments', {
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
  escalationPath: jsonb('escalation_path').$type<unknown[]>().default([]).notNull(),
  commonRejectionReasons: jsonb('common_rejection_reasons').$type<string[]>().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`),
});
