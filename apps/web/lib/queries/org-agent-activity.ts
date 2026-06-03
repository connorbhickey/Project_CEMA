import { getCurrentOrganizationId } from '@cema/auth';
import { auditEvents, deals, getDb, organizations, properties } from '@cema/db';
import { and, desc, eq, like } from 'drizzle-orm';

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
export async function getOrgAgentActivity(agentKey?: string): Promise<OrgAgentActivityRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const pattern = agentKey ? agentLikePattern(agentKey) : null;

  return withRls(org.id, async (tx) => {
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
      .where(
        pattern
          ? and(eq(auditEvents.entityType, 'deal'), like(auditEvents.action, pattern))
          : eq(auditEvents.entityType, 'deal'),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(LIMIT);

    return rows.map((r) => ({
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
  });
}
