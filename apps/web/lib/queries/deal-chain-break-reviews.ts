import { getCurrentOrganizationId } from '@cema/auth';
import { chainBreakReviewQueue, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';

import type { ChainBreakReviewRow } from '@/lib/agents/chain-of-title/merge-chain-review';
import { withRls } from '@/lib/with-rls';

/**
 * RLS-scoped read of the chain_break_review_queue rows for a deal. Returns the
 * minimal projection the merge core + UI need (the merge joins these to the
 * live attorney_review findings by breakHash). Tenant isolation is enforced by
 * the org-isolation RLS policy inside withRls.
 */
export async function getDealChainBreakReviews(dealId: string): Promise<ChainBreakReviewRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    return tx
      .select({
        id: chainBreakReviewQueue.id,
        breakHash: chainBreakReviewQueue.breakHash,
        breakKind: chainBreakReviewQueue.breakKind,
        state: chainBreakReviewQueue.state,
        reviewerId: chainBreakReviewQueue.reviewerId,
      })
      .from(chainBreakReviewQueue)
      .where(eq(chainBreakReviewQueue.dealId, dealId));
  });
}
