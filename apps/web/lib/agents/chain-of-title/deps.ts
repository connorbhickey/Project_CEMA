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

import { breakHash } from './break-hash';

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
 * documents.extractedData; the routeReChase/openAttorneyReview actuators
 * persist a per-break chain.break_routed audit; emitAudit writes the run-level
 * split audit (chain.analyzed / chain.routed counts).
 */
export function buildChainDeps({ organizationId, actorUserId }: BuildDepsArgs): ChainDeps {
  // Tier 1 actuator: persist one PII-safe chain.break_routed audit per routed
  // break, keyed by a deterministic breakHash. Both seams share this body --
  // they record the same audit shape and differ only by decision.kind, which is
  // already in the metadata. The seams stay distinct so Tier 2 can diverge (a
  // re_chase re-invokes Outreach; an attorney_review opens a review-queue row)
  // without touching the orchestrator's per-break dispatch.
  const recordBreakRouted = (decision: RouteDecision): Promise<void> =>
    withRls(organizationId, async (tx) => {
      await emitAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: 'chain.break_routed',
        entityType: 'deal',
        entityId: decision.dealId,
        metadata: {
          source: 'chain-of-title',
          kind: decision.kind,
          documentId: decision.documentId,
          reason: decision.reason,
          breakHash: breakHash(decision),
        },
      });
    });

  return {
    loadInstruments: (dealId: string): Promise<readonly InstrumentRecord[]> =>
      withRls(organizationId, async (tx) => {
        const rows = await tx
          .select({ id: documents.id, extractedData: documents.extractedData })
          .from(documents)
          .where(eq(documents.dealId, dealId));
        return rows.map(toInstrument).filter((i): i is InstrumentRecord => i !== null);
      }),

    routeReChase: recordBreakRouted,
    openAttorneyReview: recordBreakRouted,

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
