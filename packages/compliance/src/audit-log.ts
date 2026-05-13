import type { Database } from '@cema/db';
import { auditEvents } from '@cema/db';

import { redactPii } from './pii.js';

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

export async function emitAuditEvent(db: Database, event: AuditEventInput): Promise<void> {
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
