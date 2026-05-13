import type { DbOrTx } from '@cema/db';
import { auditEvents } from '@cema/db';

import { redactPii } from './pii';

export interface AuditEventInput {
  organizationId: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Emits an audit event. Accepts either a top-level Database handle (for
 * code paths outside withRls, like Clerk webhooks) or a Transaction handle
 * from a `withRls()` callback. Both share the `.insert()` API so the call
 * site is identical either way.
 */
export async function emitAuditEvent(db: DbOrTx, event: AuditEventInput): Promise<void> {
  const safeMetadata = redactPii(event.metadata ?? {});
  await db.insert(auditEvents).values({
    organizationId: event.organizationId,
    actorUserId: event.actorUserId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: safeMetadata,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
  });
}
