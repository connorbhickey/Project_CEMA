import { getCurrentOrganizationId } from '@cema/auth';
import { auditEvents, getDb, organizations } from '@cema/db';
import { and, desc, eq, gte, like, lt, or, sql } from 'drizzle-orm';

import {
  type ActivityCursor,
  type ActivityPage,
  encodeActivityCursor,
} from '../agent-activity/activity-cursor';
import { agentLikePattern } from '../agent-activity/agent-filter';
import { withRls } from '../with-rls';

export interface DealAgentActivityEvent {
  readonly id: string;
  readonly action: string;
  readonly occurredAt: Date;
  readonly metadata: Record<string, unknown>;
}

const LIMIT = 200;

/**
 * RLS-scoped: the deal's agent + lifecycle audit trail (entityType='deal'),
 * newest first. Tenancy flows audit_events.organizationId via withRls; the deal
 * filter is entityId. Returns [] if the org is unresolved. Mirrors the
 * org-resolution in getDealDocumentsReview.
 */
export async function getDealAgentActivity(
  dealId: string,
  agentKey?: string,
  since?: Date,
  cursor?: ActivityCursor,
): Promise<ActivityPage<DealAgentActivityEvent>> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return { items: [], nextCursor: null };

  const pattern = agentKey ? agentLikePattern(agentKey) : null;
  // ms-precision keyset comparison -- see getOrgAgentActivity for why.
  const occurredAtMs = sql`date_trunc('milliseconds', ${auditEvents.occurredAt})`;

  return withRls(org.id, async (tx): Promise<ActivityPage<DealAgentActivityEvent>> => {
    const conditions = [eq(auditEvents.entityType, 'deal'), eq(auditEvents.entityId, dealId)];
    if (pattern) conditions.push(like(auditEvents.action, pattern));
    if (since) conditions.push(gte(auditEvents.occurredAt, since));
    if (cursor) {
      const keyset = or(
        lt(occurredAtMs, cursor.occurredAt),
        and(eq(occurredAtMs, cursor.occurredAt), lt(auditEvents.id, cursor.id)),
      );
      if (keyset) conditions.push(keyset);
    }

    const rows = await tx
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        occurredAt: auditEvents.occurredAt,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(desc(occurredAtMs), desc(auditEvents.id))
      .limit(LIMIT + 1);

    const hasMore = rows.length > LIMIT;
    const page = hasMore ? rows.slice(0, LIMIT) : rows;
    const items = page.map((r) => ({
      id: r.id,
      action: r.action,
      occurredAt: r.occurredAt,
      metadata: r.metadata ?? {},
    }));
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeActivityCursor({ occurredAt: last.occurredAt, id: last.id }) : null;
    return { items, nextCursor };
  });
}
