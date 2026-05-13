import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { organizations, users } from './tenants.js';

// ---------------------------------------------------------------------------
// auditEvents — append-only audit log for the entire system.
//
// CLAUDE.md hard rule (Audit log immutability): Append-only. Never UPDATE or
// DELETE an audit row. Every Deal status change, document state transition,
// attorney approval, communication recording, and PII access emits an event.
// Tampering is an automatic incident.
//
// Intentionally NO updatedAt: this table is append-only by convention.
// The application MUST NOT issue UPDATE or DELETE on this table.
// ---------------------------------------------------------------------------
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Restrict: orgs use soft-delete. Restrict prevents orphaned audit rows when
    // an org is soft-deleted — the audit trail must remain linked.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // Nullable: system-generated events (cron, migrations) may have no actor user.
    // Restrict on user: soft-deleted users must not lose their audit trail.
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    // Structured action name, e.g. "deal.status.changed", "document.approved",
    // "attorney_approval.created", "pii.accessed". Max 128 chars.
    action: varchar('action', { length: 128 }).notNull(),
    // Entity class (e.g. "deal", "document", "party", "attorney_approval").
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    // UUID of the specific entity instance affected. Nullable for bulk ops.
    entityId: uuid('entity_id'),
    // Structured payload — diffs, before/after state, context. PII-redacted
    // via redactPii() before insertion (Task 11 packages/compliance).
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    // Request context — stored for security audit (rate limiting, anomaly detection).
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    // Use occurredAt, not createdAt, to allow backdating for migration events.
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Primary query: org-scoped audit log ordered by time (timeline view, exports).
    index('audit_events_org_occurred_idx').on(t.organizationId, t.occurredAt),
    // Entity-scoped query: "all events for this deal" (deal audit trail sidebar).
    index('audit_events_entity_idx').on(t.entityType, t.entityId),
    // Actor query: "all actions by this user" (security review, HR requests).
    index('audit_events_actor_user_id_idx').on(t.actorUserId),
    // Action query: "all status changes" (compliance reporting).
    index('audit_events_action_idx').on(t.action),
  ],
);
