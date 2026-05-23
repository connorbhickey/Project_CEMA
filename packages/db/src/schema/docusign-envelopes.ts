import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { documents } from './documents';
import { orgDocusignConnections } from './docusign-connections';
import { envelopeStatusEnum } from './enums';
import { organizations, users } from './tenants';

export interface DocusignRecipient {
  email: string;
  name: string;
  role: string;
  routingOrder: number;
  status: 'created' | 'sent' | 'delivered' | 'signed' | 'declined' | 'completed';
  signedAt: string | null;
}

export const docusignEnvelopes = pgTable(
  'docusign_envelopes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    docusignConnectionId: uuid('docusign_connection_id')
      .notNull()
      .references(() => orgDocusignConnections.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    docusignEnvelopeId: varchar('docusign_envelope_id', { length: 128 }).notNull(),
    status: envelopeStatusEnum('status').notNull().default('created'),
    subject: text('subject'),
    recipients: jsonb('recipients').$type<DocusignRecipient[]>().default([]).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    voidedReason: text('voided_reason'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('docusign_envelopes_docusign_envelope_id_uidx').on(
      t.docusignConnectionId,
      t.docusignEnvelopeId,
    ),
    index('docusign_envelopes_organization_id_idx').on(t.organizationId),
    index('docusign_envelopes_document_id_idx').on(t.documentId),
    index('docusign_envelopes_org_status_idx').on(t.organizationId, t.status),
    check(
      'docusign_envelopes_completed_at_requires_status',
      sql`${t.completedAt} IS NULL OR ${t.status} IN ('completed', 'signed', 'voided', 'declined')`,
    ),
  ],
);
