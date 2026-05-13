import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { deals } from './deals.js';
import { partyRoleEnum } from './enums.js';

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
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [index('parties_deal_id_idx').on(t.dealId), index('parties_email_idx').on(t.email)],
);
