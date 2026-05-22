import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { deals } from './deals';
import { partyRoleEnum } from './enums';

export const parties = pgTable(
  'parties',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Parties are owned by a deal — cascade if a deal is hard-deleted.
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    role: partyRoleEnum('role').notNull(),
    fullName: text('full_name'),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 32 }),
    // SSN encrypted at app layer via packages/compliance (Task 11).
    // Stored as text ciphertext — pgcrypto-encrypted, never plaintext.
    // Hard rule #3: PII (SSN) must be encrypted at rest.
    ssnEncrypted: text('ssn_encrypted'),
    // Hard rule #4: TCPA opt-in. Defaults to false so the absence of a
    // consent record is interpreted as "no consent" by every code path.
    // Application code MUST consult these before any outbound voice/SMS to
    // a borrower-role party; the `tcpaGuard()` helper in M2 Task 17 reads
    // them. The DB CHECK below makes tcpa_opt_in=true require a timestamp,
    // so the application cannot accidentally mark consent without recording
    // when it was obtained (consent without a date is unprovable).
    tcpaOptIn: boolean('tcpa_opt_in').notNull().default(false),
    tcpaOptInAt: timestamp('tcpa_opt_in_at', { withTimezone: true }),
    // Free-form audit string identifying HOW consent was obtained. Expected
    // values today: 'app_form', 'loan_app_addendum', 'recorded_verbal'.
    // Kept as varchar rather than an enum because the source set will grow
    // over time (e.g., 'borrower_portal' in Phase 1) and an enum migration
    // per source would be heavyweight; app layer validates against a known
    // list and the audit log captures the value verbatim for legal defense.
    tcpaOptInSource: varchar('tcpa_opt_in_source', { length: 64 }),
    // Set by the click-to-call / recording-pipeline code (M2 Tasks 15-17)
    // when the two-party recording disclosure has been read or played to
    // the callee. Hard rule #5: every recorded call must have a disclosure
    // event; this column makes the per-party history queryable.
    recordingDisclosureConfirmedAt: timestamp('recording_disclosure_confirmed_at', {
      withTimezone: true,
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    index('parties_deal_id_idx').on(t.dealId),
    index('parties_email_idx').on(t.email),
    // Hard rule #3: Reject plaintext SSN at insert time. Any value matching the
    // SSN pattern (123-45-6789, 123456789, etc.) is rejected. Encrypted
    // ciphertext (pgcrypto output) does not match this pattern and passes.
    check(
      'parties_ssn_encrypted_not_plaintext',
      sql`${t.ssnEncrypted} IS NULL OR NOT (${t.ssnEncrypted} ~ '^\\d{3}-?\\d{2}-?\\d{4}$')`,
    ),
    // Hard rule #4: prevent the inconsistent "opted in but no timestamp"
    // state. Defense in depth against an application bug that flips the
    // boolean without recording when consent was obtained.
    check(
      'parties_tcpa_opt_in_requires_timestamp',
      sql`${t.tcpaOptIn} = false OR ${t.tcpaOptInAt} IS NOT NULL`,
    ),
  ],
);
