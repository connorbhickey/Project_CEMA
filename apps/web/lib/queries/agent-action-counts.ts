import { getCurrentOrganizationId } from '@cema/auth';
import { auditEvents, getDb, organizations } from '@cema/db';
import { and, eq, sql } from 'drizzle-orm';

import { type AgentActionCount } from '../dashboard/agent-activity-summary';
import { withRls } from '../with-rls';

/**
 * RLS-scoped: count deal-scoped audit actions grouped by action for the current
 * org (all-time). Mirrors the dashboard feed's entityType='deal' filter, so the
 * counts cover the agent + deal-lifecycle actions and exclude document-scoped
 * events. Returns [] if the org is unresolved.
 */
export async function getAgentActionCounts(): Promise<AgentActionCount[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({ action: auditEvents.action, count: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, org.id), eq(auditEvents.entityType, 'deal')))
      .groupBy(auditEvents.action);
    return rows.map((r) => ({ action: r.action, count: r.count }));
  });
}
