import { getCurrentOrganizationId } from '@cema/auth';
import { auditEventReads, getDb, organizations, users } from '@cema/db';
import { and, desc, eq, gte } from 'drizzle-orm';

import { withRls } from '../with-rls';

type AuditRead = typeof auditEventReads.$inferSelect;
type User = typeof users.$inferSelect;

export interface AuditReadRow {
  read: AuditRead;
  actor: User | null;
}

export interface ListAuditReadsInput {
  entityType?:
    | 'communication'
    | 'document'
    | 'recording'
    | 'pii_field'
    | 'contact'
    | 'deal'
    | 'envelope';
  entityId?: string;
  actorUserId?: string;
  sinceDays?: number;
  limit?: number;
}

export async function listAuditEventReads(
  input: ListAuditReadsInput = {},
): Promise<AuditReadRow[]> {
  const { entityType, entityId, actorUserId, sinceDays = 7, limit = 100 } = input;
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const filters = [
    eq(auditEventReads.organizationId, org.id),
    gte(auditEventReads.createdAt, since),
  ];
  if (entityType) filters.push(eq(auditEventReads.entityType, entityType));
  if (entityId) filters.push(eq(auditEventReads.entityId, entityId));
  if (actorUserId) filters.push(eq(auditEventReads.actorUserId, actorUserId));

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select()
      .from(auditEventReads)
      .where(and(...filters))
      .orderBy(desc(auditEventReads.createdAt))
      .limit(limit);

    const userIds = new Set(rows.map((r) => r.actorUserId));
    const userRows = userIds.size === 0 ? [] : await tx.select().from(users);
    const userById = new Map(userRows.filter((u) => userIds.has(u.id)).map((u) => [u.id, u]));

    return rows.map((r) => ({ read: r, actor: userById.get(r.actorUserId) ?? null }));
  });
}
