import { communications, documents, emailThreads, getDb } from '@cema/db';
import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm';

import {
  type ActivityCursor,
  type ActivityPage,
  encodeActivityCursor,
} from '../agent-activity/activity-cursor';

import type { DealActivityType } from './deal-activity-filter';

export type DealActivityEvent = {
  type: DealActivityType;
  id: string;
  occurredAt: Date;
  label: string;
  detail: string | null;
};

export interface DealActivityOptions {
  /** Narrow to one source; null/undefined = the merged feed. */
  readonly type?: DealActivityType | null;
  /** Keyset cursor — everything strictly older than (occurredAt, id). */
  readonly cursor?: ActivityCursor | null;
}

const LIMIT = 200;

/**
 * The deal's activity feed: communications + documents merged newest-first, with
 * an optional `type` filter and keyset pagination.
 *
 * Both sub-queries and the in-memory merge use the SAME total order
 * `(occurredAt desc, id desc)`, so the single (occurredAt, id) cursor walks the
 * merged stream losslessly even though its id alternates between the two
 * id-spaces. occurredAt is compared at ms precision (date_trunc) to match the
 * cursor's ms-precision Date (JS Dates are ms, so the in-memory .getTime()
 * comparison is already ms-truncated — the two agree). Each included sub-query
 * fetches LIMIT+1 so the merged length > LIMIT reliably signals "more exist".
 */
export async function getDealActivity(
  dealId: string,
  opts: DealActivityOptions = {},
): Promise<ActivityPage<DealActivityEvent>> {
  const db = getDb();
  const { type = null, cursor = null } = opts;

  const wantComms = type === null || type === 'communication';
  const wantDocs = type === null || type === 'document';

  const commsOccurredAtMs = sql`date_trunc('milliseconds', ${communications.startedAt})`;
  const docsOccurredAtMs = sql`date_trunc('milliseconds', ${documents.createdAt})`;

  const commsConditions = [eq(communications.dealId, dealId), isNotNull(communications.startedAt)];
  if (cursor) {
    const keyset = or(
      lt(commsOccurredAtMs, cursor.occurredAt),
      and(eq(commsOccurredAtMs, cursor.occurredAt), lt(communications.id, cursor.id)),
    );
    if (keyset) commsConditions.push(keyset);
  }

  const docsConditions = [eq(documents.dealId, dealId)];
  if (cursor) {
    const keyset = or(
      lt(docsOccurredAtMs, cursor.occurredAt),
      and(eq(docsOccurredAtMs, cursor.occurredAt), lt(documents.id, cursor.id)),
    );
    if (keyset) docsConditions.push(keyset);
  }

  const [comms, docs] = await Promise.all([
    wantComms
      ? db
          .select({
            id: communications.id,
            kind: communications.kind,
            occurredAt: communications.startedAt,
            subject: emailThreads.subject,
          })
          .from(communications)
          .leftJoin(emailThreads, eq(emailThreads.communicationId, communications.id))
          .where(and(...commsConditions))
          .orderBy(desc(commsOccurredAtMs), desc(communications.id))
          .limit(LIMIT + 1)
      : Promise.resolve([]),
    wantDocs
      ? db
          .select({
            id: documents.id,
            kind: documents.kind,
            occurredAt: documents.createdAt,
          })
          .from(documents)
          .where(and(...docsConditions))
          .orderBy(desc(docsOccurredAtMs), desc(documents.id))
          .limit(LIMIT + 1)
      : Promise.resolve([]),
  ]);

  // Documents have no human-readable detail field (no `filename` column; `kind`
  // conveys what the row is), so detail is null for docs until IDP adds a name.
  const merged: DealActivityEvent[] = [
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
      detail: null,
    })),
  ];

  // Same total order as the keyset predicate: occurredAt desc, then id desc.
  merged.sort((a, b) => {
    const dt = b.occurredAt.getTime() - a.occurredAt.getTime();
    if (dt !== 0) return dt;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  const hasMore = merged.length > LIMIT;
  const items = hasMore ? merged.slice(0, LIMIT) : merged;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeActivityCursor({ occurredAt: last.occurredAt, id: last.id }) : null;

  return { items, nextCursor };
}
