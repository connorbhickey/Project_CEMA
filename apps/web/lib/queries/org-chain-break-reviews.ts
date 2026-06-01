import type { ChainBreakReviewState } from '@cema/attorney';
import { getCurrentOrganizationId } from '@cema/auth';
import { chainBreakReviewQueue, deals, getDb, organizations } from '@cema/db';
import { and, desc, eq, or } from 'drizzle-orm';

import { withRls } from '@/lib/with-rls';

export interface OrgChainBreakReviewItem {
  id: string;
  dealId: string;
  dealStatus: string;
  breakKind: string;
  reason: string;
  state: ChainBreakReviewState;
  reviewerId: string | null;
  submittedAt: Date;
}

/**
 * Cross-deal chain-break review queue for the attorney inbox. RLS-scoped to the
 * caller's org (the org-isolation policy on chain_break_review_queue enforces
 * tenancy inside withRls). `stateFilter: 'open'` (default) returns only pending +
 * claimed rows (the actionable triage set); 'all' includes terminal rows. The
 * actual claim/resolve/dismiss actions live on each deal's review surface
 * (/deals/[id]/documents) — this list is triage that links into those.
 */
export async function getOrgChainBreakReviews(
  options: { stateFilter?: 'open' | 'all' } = {},
): Promise<OrgChainBreakReviewItem[]> {
  const { stateFilter = 'open' } = options;
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const openOnly = or(
      eq(chainBreakReviewQueue.state, 'pending'),
      eq(chainBreakReviewQueue.state, 'claimed'),
    );
    const where =
      stateFilter === 'open'
        ? and(eq(chainBreakReviewQueue.organizationId, org.id), openOnly)
        : eq(chainBreakReviewQueue.organizationId, org.id);

    return tx
      .select({
        id: chainBreakReviewQueue.id,
        dealId: chainBreakReviewQueue.dealId,
        dealStatus: deals.status,
        breakKind: chainBreakReviewQueue.breakKind,
        reason: chainBreakReviewQueue.reason,
        state: chainBreakReviewQueue.state,
        reviewerId: chainBreakReviewQueue.reviewerId,
        submittedAt: chainBreakReviewQueue.submittedAt,
      })
      .from(chainBreakReviewQueue)
      .innerJoin(deals, eq(deals.id, chainBreakReviewQueue.dealId))
      .where(where)
      .orderBy(desc(chainBreakReviewQueue.submittedAt));
  });
}
