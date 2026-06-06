import { triageExceptions, type Exception } from '@cema/agents-exception-triage';
import { getCurrentOrganizationId } from '@cema/auth';
import { auditEvents, chainBreakReviewQueue, deals, getDb, organizations, parties } from '@cema/db';
import { and, eq, or, sql } from 'drizzle-orm';

import { isPurchaseMissingSeller } from './purchase-seller-signal';

import { withRls } from '@/lib/with-rls';


/**
 * Per-deal exception triage (spec §9.11) — the same pull/derive model as the
 * cross-deal `getOrgExceptions`, scoped to ONE deal so the deal's own exceptions
 * (chain breaks, a dispatch failure, a rejected recording, deal_status='exception',
 * a Purchase CEMA missing its seller) show in context. RLS-scoped: the deal is
 * confirmed in-org first, then its live signals are gathered and run through the
 * pure `triageExceptions` classifier. Recompute-live (no table).
 */
export async function getDealExceptions(dealId: string): Promise<Exception[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const [deal] = await tx
      .select({ id: deals.id, status: deals.status, cemaType: deals.cemaType })
      .from(deals)
      .where(eq(deals.id, dealId))
      .limit(1);
    if (!deal) return [];

    const [chain] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(chainBreakReviewQueue)
      .where(
        and(
          eq(chainBreakReviewQueue.dealId, dealId),
          or(
            eq(chainBreakReviewQueue.state, 'pending'),
            eq(chainBreakReviewQueue.state, 'claimed'),
          ),
        ),
      );

    const dispatch = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, dealId), eq(auditEvents.action, 'deal.agent_dispatch_failed')),
      )
      .limit(1);

    const rejected = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, dealId), eq(auditEvents.action, 'recording.rejected')))
      .limit(1);

    const seller = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.dealId, dealId), eq(parties.role, 'seller')))
      .limit(1);

    return triageExceptions({
      dealStatus: deal.status,
      chainBreakCount: chain?.count ?? 0,
      dispatchFailed: dispatch.length > 0,
      recordingRejected: rejected.length > 0,
      purchaseMissingSeller: isPurchaseMissingSeller(deal.cemaType, deal.status, seller.length > 0),
    });
  });
}
