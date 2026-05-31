import { withChildSpan } from '@cema/observability';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import { classify } from './classify';
import { extract } from './extract';
import type { ClassifiedDoc, IdpDeps, IdpResult, UnreadableSegment } from './types';
import { UNREADABLE_CONFIDENCE_THRESHOLD } from './types';

const tracer = trace.getTracer('@cema/agents-collateral-idp');

/**
 * Orchestration-agnostic Collateral IDP core. Loads the deal's collateral
 * documents, runs each blob through the (dormant) vendor adapter, and
 * deterministically classifies + extracts every readable segment into an
 * InstrumentRecord -- enriching the source documents row 1:1 in place. A
 * segment with null text or sub-threshold confidence is routed to the
 * unreadable bucket (surfaced for human review) and never persisted.
 *
 * Split audit: idp.evaluated is emitted on EVERY run before any write;
 * idp.documents_classified is written co-transactionally with the enrich
 * inside deps.persistDocuments (app wiring), so it only fires when there is
 * something to persist.
 */
export async function runCollateralIdp(dealId: string, deps: IdpDeps): Promise<IdpResult> {
  return tracer.startActiveSpan('idp.run', async (span) => {
    span.setAttribute('idp.deal_id', dealId);
    try {
      const context = await withChildSpan(tracer, 'idp.load_context', () =>
        deps.loadContext(dealId),
      );

      const classified: ClassifiedDoc[] = [];
      const unreadable: UnreadableSegment[] = [];

      await withChildSpan(tracer, 'idp.extract_documents', async () => {
        for (const ref of context.documents) {
          const segments = await deps.idp.extractDocuments(ref.blobUrl);
          const raw = segments[0];
          if (!raw || raw.confidence < UNREADABLE_CONFIDENCE_THRESHOLD) {
            unreadable.push({ documentId: ref.documentId, blobUrl: ref.blobUrl });
            continue;
          }
          const classification = classify(raw);
          classified.push({
            documentId: ref.documentId,
            kind: classification.kind,
            attorneyReviewRequired: classification.attorneyReviewRequired,
            instrument: extract(ref.documentId, raw, classification),
          });
        }
      });

      const gateRequiredCount = classified.filter((d) => d.attorneyReviewRequired).length;
      span.setAttribute('idp.document_count', classified.length);
      span.setAttribute('idp.unreadable_count', unreadable.length);
      span.setAttribute('idp.gate_required_count', gateRequiredCount);

      await withChildSpan(tracer, 'idp.emit_evaluated', () =>
        deps.emitAudit({
          action: 'idp.evaluated',
          dealId,
          documentCount: classified.length,
          unreadableCount: unreadable.length,
          gateRequiredCount,
        }),
      );

      if (classified.length > 0) {
        await withChildSpan(tracer, 'idp.persist_documents', () =>
          deps.persistDocuments(dealId, classified),
        );
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return { dealId, documents: classified, unreadable };
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
