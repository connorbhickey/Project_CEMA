import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditReadEntityTypeEnum, auditReadPurposeEnum } from './enums';
import { organizations, users } from './tenants';

// ---------------------------------------------------------------------------
// audit_event_reads — SOC 2 read-access audit log (M5 task 20).
//
// Every time a processor or agent reads a sensitive entity (communication,
// document, recording, PII field, contact, deal, or envelope) a row is
// appended here via withReadAudit. This table is append-only and protected
// by the same immutability triggers as audit_events.
//
// actorIp is the requester's IP, nullable because server actions running
// inside RSC don't have easy access to the IP in all environments. Phase 1
// will populate it via the Vercel request headers helper.
// ---------------------------------------------------------------------------
export const auditEventReads = pgTable(
  'audit_event_reads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    entityType: auditReadEntityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    purpose: auditReadPurposeEnum('purpose').notNull(),
    actorIp: text('actor_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('audit_event_reads_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_event_reads_entity_idx').on(t.entityType, t.entityId),
    index('audit_event_reads_actor_idx').on(t.actorUserId, t.createdAt),
  ],
);
