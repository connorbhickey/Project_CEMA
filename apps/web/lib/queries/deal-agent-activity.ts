import { getCurrentOrganizationId } from '@cema/auth';
import { auditEvents, getDb, organizations } from '@cema/db';
import { and, desc, eq, like } from 'drizzle-orm';

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
): Promise<DealAgentActivityEvent[]> {
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
      })
      .from(auditEvents)
      .where(
        pattern
          ? and(
              eq(auditEvents.entityType, 'deal'),
              eq(auditEvents.entityId, dealId),
              like(auditEvents.action, pattern),
            )
          : and(eq(auditEvents.entityType, 'deal'), eq(auditEvents.entityId, dealId)),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(LIMIT);

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      occurredAt: r.occurredAt,
      metadata: r.metadata ?? {},
    }));
  });
}
