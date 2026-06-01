import { triageExceptions, type Exception } from '@cema/agents-exception-triage';
import { getCurrentOrganizationId } from '@cema/auth';
import { auditEvents, chainBreakReviewQueue, deals, getDb, organizations } from '@cema/db';
import { and, eq, or, sql } from 'drizzle-orm';

import { withRls } from '@/lib/with-rls';

export interface DealExceptions {
  dealId: string;
  dealStatus: string;
  exceptions: Exception[];
}

/**
 * Cross-deal exception triage (spec §9.11, pull model). RLS-scoped: gathers each
 * deal's live exception signals — open chain_break_review_queue rows, a
 * deal.agent_dispatch_failed audit, deal_status='exception' — into DealSignals,
 * runs the pure triageExceptions classifier, and returns the deals carrying at
 * least one exception. Recompute-live (no table); derives from what the other
 * Layer-3 agents already emit (no agent changes).
 */
export async function getOrgExceptions(): Promise<DealExceptions[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const dealRows = await tx
      .select({ id: deals.id, status: deals.status })
      .from(deals)
      .where(eq(deals.organizationId, org.id));
    if (dealRows.length === 0) return [];

    // Open chain-break counts per deal.
    const chainRows = await tx
      .select({ dealId: chainBreakReviewQueue.dealId, count: sql<number>`count(*)::int` })
      .from(chainBreakReviewQueue)
      .where(
        and(
          eq(chainBreakReviewQueue.organizationId, org.id),
          or(
            eq(chainBreakReviewQueue.state, 'pending'),
            eq(chainBreakReviewQueue.state, 'claimed'),
          ),
        ),
      )
      .groupBy(chainBreakReviewQueue.dealId);
    const chainCountByDeal = new Map(chainRows.map((r) => [r.dealId, r.count]));

    // Deals with a dispatch-failure audit (entityId is the dealId).
    const dispatchRows = await tx
      .select({ entityId: auditEvents.entityId })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, org.id),
          eq(auditEvents.action, 'deal.agent_dispatch_failed'),
        ),
      );
    const dispatchFailedDeals = new Set(dispatchRows.map((r) => r.entityId));

    const out: DealExceptions[] = [];
    for (const d of dealRows) {
      const exceptions = triageExceptions({
        dealStatus: d.status,
        chainBreakCount: chainCountByDeal.get(d.id) ?? 0,
        dispatchFailed: dispatchFailedDeals.has(d.id),
      });
      if (exceptions.length > 0) out.push({ dealId: d.id, dealStatus: d.status, exceptions });
    }
    return out;
  });
}
