import { communications, documents, emailThreads, getDb } from '@cema/db';
import { and, desc, eq, isNotNull } from 'drizzle-orm';

export type DealActivityEvent = {
  type: 'communication' | 'document';
  id: string;
  occurredAt: Date;
  label: string;
  detail: string | null;
};

const LIMIT = 200;

export async function getDealActivity(dealId: string): Promise<DealActivityEvent[]> {
  const db = getDb();

  const [comms, docs] = await Promise.all([
    db
      .select({
        id: communications.id,
        kind: communications.kind,
        occurredAt: communications.startedAt,
        subject: emailThreads.subject,
      })
      .from(communications)
      .leftJoin(emailThreads, eq(emailThreads.communicationId, communications.id))
      .where(and(eq(communications.dealId, dealId), isNotNull(communications.startedAt)))
      .orderBy(desc(communications.startedAt))
      .limit(LIMIT),

    db
      .select({
        id: documents.id,
        kind: documents.kind,
        occurredAt: documents.createdAt,
        subject: documents.blobUrl,
      })
      .from(documents)
      .where(eq(documents.dealId, dealId))
      .orderBy(desc(documents.createdAt))
      .limit(LIMIT),
  ]);

  // kg_edges has no dealId — traversal via contact→party→deal is Phase 1.
  const events: DealActivityEvent[] = [
    ...comms.map((c) => ({
      type: 'communication' as const,
      id: c.id,
      occurredAt: c.occurredAt ?? new Date(0),
      label: `${c.kind.charAt(0).toUpperCase()}${c.kind.slice(1)}`,
      detail: c.subject ?? null,
    })),
    ...docs.map((d) => ({
      type: 'document' as const,
      id: d.id,
      occurredAt: d.occurredAt,
      label: d.kind.replace(/_/g, ' '),
      detail: d.subject ?? null,
    })),
  ];

  return events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}
