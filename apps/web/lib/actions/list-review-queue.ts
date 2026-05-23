import { getCurrentOrganizationId } from '@cema/auth';
import { documentReviewQueue, documents, getDb, organizations, users } from '@cema/db';
import { and, desc, eq, or } from 'drizzle-orm';

import { withRls } from '../with-rls';

type QueueRow = typeof documentReviewQueue.$inferSelect;
type Document = typeof documents.$inferSelect;
type User = typeof users.$inferSelect;

export interface ReviewQueueItem {
  queue: QueueRow;
  document: Document | null;
  submittedBy: User | null;
  reviewer: User | null;
}

export async function listReviewQueue(
  options: { stateFilter?: 'pending' | 'claimed' | 'all'; limit?: number } = {},
): Promise<ReviewQueueItem[]> {
  const { stateFilter = 'all', limit = 50 } = options;
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const stateFilterSql =
      stateFilter === 'pending'
        ? eq(documentReviewQueue.state, 'pending')
        : stateFilter === 'claimed'
          ? eq(documentReviewQueue.state, 'claimed')
          : or(eq(documentReviewQueue.state, 'pending'), eq(documentReviewQueue.state, 'claimed'));

    const rows = await tx
      .select({ queue: documentReviewQueue, document: documents })
      .from(documentReviewQueue)
      .leftJoin(documents, eq(documents.id, documentReviewQueue.documentId))
      .where(and(eq(documentReviewQueue.organizationId, org.id), stateFilterSql))
      .orderBy(desc(documentReviewQueue.submittedAt))
      .limit(limit);

    const userIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.queue.submittedById);
      if (r.queue.reviewerId) userIds.add(r.queue.reviewerId);
    }
    const userRows = userIds.size === 0 ? [] : await tx.select().from(users);
    const userById = new Map(userRows.filter((u) => userIds.has(u.id)).map((u) => [u.id, u]));

    return rows.map((r) => ({
      queue: r.queue,
      document: r.document,
      submittedBy: userById.get(r.queue.submittedById) ?? null,
      reviewer: r.queue.reviewerId ? (userById.get(r.queue.reviewerId) ?? null) : null,
    }));
  });
}
