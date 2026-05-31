import 'server-only';

import { runChainOfTitle } from '@cema/agents-chain-of-title';
import type {
  ChainAuditEvent,
  ChainDeps,
  ChainResult,
  InstrumentRecord,
  RouteDecision,
} from '@cema/agents-chain-of-title';
import { emitAuditEvent } from '@cema/compliance';
import { documents } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../../with-rls';

interface BuildDepsArgs {
  readonly organizationId: string;
  readonly actorUserId: string;
}

// The InstrumentRecord the Collateral IDP persisted lives in
// documents.extractedData. We trust the IDP's shape but defensively drop any
// row whose payload is null or lacks a string instrumentKind (a non-IDP doc).
function toInstrument(row: { id: string; extractedData: unknown }): InstrumentRecord | null {
  const data = row.extractedData;
  if (data === null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.instrumentKind !== 'string') return null;
  return record as unknown as InstrumentRecord;
}

/**
 * Builds ChainDeps for the app. Every effect runs inside withRls so the deal's
 * documents are tenant-scoped (the documents table has no organizationId
 * column -- tenancy flows through deal_id -> deals, mirroring the IDP deps).
 * loadInstruments reads the InstrumentRecord[] the IDP enriched onto
 * documents.extractedData; emitAudit writes the split audit (counts only).
 */
export function buildChainDeps({ organizationId, actorUserId }: BuildDepsArgs): ChainDeps {
  return {
    loadInstruments: (dealId: string): Promise<readonly InstrumentRecord[]> =>
      withRls(organizationId, async (tx) => {
        const rows = await tx
          .select({ id: documents.id, extractedData: documents.extractedData })
          .from(documents)
          .where(eq(documents.dealId, dealId));
        return rows.map(toInstrument).filter((i): i is InstrumentRecord => i !== null);
      }),

    // Dormant per-route actuators (carry-over #1). Once a re-chase trigger and
    // an attorney-review surface exist, these dispatch idempotently (keyed
    // chain:<dealId>:break:<hash>). Until then routing is durable solely via the
    // chain.routed audit event (emitAudit, below) -- the in-memory RouteDecision[]
    // is still returned to the caller. No-op now keeps the orchestrator wiring stable.
    routeReChase: (_decision: RouteDecision): Promise<void> => Promise.resolve(),

    openAttorneyReview: (_decision: RouteDecision): Promise<void> => Promise.resolve(),

    emitAudit: (event: ChainAuditEvent): Promise<void> =>
      withRls(organizationId, async (tx) => {
        await emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: event.action,
          entityType: 'deal',
          entityId: event.dealId,
          metadata: {
            source: 'chain-of-title',
            status: event.status,
            breakCount: event.breakCount,
            reChaseCount: event.reChaseCount,
            attorneyReviewCount: event.attorneyReviewCount,
          },
        });
      }),
  };
}

export type { ChainResult };
export { runChainOfTitle };
