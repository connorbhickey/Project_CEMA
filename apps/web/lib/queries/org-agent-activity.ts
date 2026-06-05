import { getCurrentOrganizationId } from '@cema/auth';
import { auditEvents, deals, getDb, organizations, properties } from '@cema/db';
import { and, desc, eq, gte, like, lt, or, sql } from 'drizzle-orm';

import {
  type ActivityCursor,
  type ActivityPage,
  encodeActivityCursor,
} from '../agent-activity/activity-cursor';
import { agentLikePattern } from '../agent-activity/agent-filter';
import { type OrgAgentActivityRow } from '../agent-activity/org-activity-item';
import { withRls } from '../with-rls';

const LIMIT = 50;

/**
 * RLS-scoped: the org's recent agent + lifecycle audit trail across ALL deals,
 * newest first. `audit_events` (entityType='deal') ⋈ `deals` (link + cemaType +
 * status) ⋈ `properties` (address). Both audit_events and deals carry org RLS,
 * so the inner join is org-isolated. Returns [] if the org is unresolved.
 * Mirrors the getOrgExceptions org-resolution pattern.
 */
export async function getOrgAgentActivity(
  agentKey?: string,
  since?: Date,
  cursor?: ActivityCursor,
): Promise<ActivityPage<OrgAgentActivityRow>> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return { items: [], nextCursor: null };

  const pattern = agentKey ? agentLikePattern(agentKey) : null;
  // Compare occurredAt at millisecond precision so the keyset matches the
  // ms-precision JS Date the cursor carries (pg truncates microseconds into JS
  // Dates) -- otherwise co-transactional audits written microseconds apart could
  // be skipped at a page boundary.
  const occurredAtMs = sql`date_trunc('milliseconds', ${auditEvents.occurredAt})`;

  return withRls(org.id, async (tx): Promise<ActivityPage<OrgAgentActivityRow>> => {
    const conditions = [eq(auditEvents.entityType, 'deal')];
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
        dealId: deals.id,
        cemaType: deals.cemaType,
        status: deals.status,
        streetAddress: properties.streetAddress,
        city: properties.city,
      })
      .from(auditEvents)
      .innerJoin(deals, eq(auditEvents.entityId, deals.id))
      .leftJoin(properties, eq(deals.propertyId, properties.id))
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
      dealId: r.dealId,
      cemaType: r.cemaType,
      status: r.status,
      streetAddress: r.streetAddress,
      city: r.city,
    }));
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeActivityCursor({ occurredAt: last.occurredAt, id: last.id }) : null;
    return { items, nextCursor };
  });
}
