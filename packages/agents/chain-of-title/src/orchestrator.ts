import { withChildSpan } from '@cema/observability';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import { analyzeChain } from './chain';
import { route } from './route';
import type { ChainDeps, ChainResult, RouteDecision } from './types';

const tracer = trace.getTracer('@cema/agents-chain-of-title');

/**
 * Orchestration-agnostic Chain-of-Title core. Loads the deal's persisted
 * InstrumentRecord[] (written 1:1 onto documents by the Collateral IDP),
 * deterministically classifies every break in the recorded chain, and routes
 * each break to re-chase or attorney review. No app/DB/Clerk/LLM import; every
 * effect is injected via ChainDeps, so the flat await chain maps 1:1 onto a WDK
 * step boundary (dormant durable wrap in PR-4).
 *
 * Split audit: chain.analyzed is emitted on EVERY run before any write;
 * chain.routed is emitted once inside the chain.route span (aggregate counts),
 * after each break is dispatched to its dormant actuator seam
 * (deps.routeReChase / deps.openAttorneyReview). A clean chain emits
 * chain.analyzed only -- no seam is called and no chain.routed is written.
 *
 * Only 3 child spans (vs IDP's 4) because analyze + route are synchronous pure
 * calls -- there is no async "extract" boundary to span.
 */
export async function runChainOfTitle(dealId: string, deps: ChainDeps): Promise<ChainResult> {
  return tracer.startActiveSpan('chain.run', async (span) => {
    span.setAttribute('chain.deal_id', dealId);
    try {
      const instruments = await withChildSpan(tracer, 'chain.load_instruments', () =>
        deps.loadInstruments(dealId),
      );

      const analysis = analyzeChain(instruments);
      const routes: readonly RouteDecision[] = route(dealId, analysis.breaks);

      const reChaseCount = routes.filter((r) => r.kind === 're_chase').length;
      const attorneyReviewCount = routes.filter((r) => r.kind === 'attorney_review').length;

      span.setAttribute('chain.status', analysis.status);
      span.setAttribute('chain.edge_count', analysis.edges.length);
      span.setAttribute('chain.break_count', analysis.breaks.length);
      span.setAttribute('chain.re_chase_count', reChaseCount);
      span.setAttribute('chain.attorney_review_count', attorneyReviewCount);

      await withChildSpan(tracer, 'chain.emit_analyzed', () =>
        deps.emitAudit({
          action: 'chain.analyzed',
          dealId,
          status: analysis.status,
          breakCount: analysis.breaks.length,
          reChaseCount,
          attorneyReviewCount,
        }),
      );

      if (analysis.breaks.length > 0) {
        // One chain.route span dispatches every break to its dormant actuator
        // seam, then emits the single aggregate chain.routed audit. advisory_pass
        // (clean chains) never reaches here, so no seam is called.
        await withChildSpan(tracer, 'chain.route', async () => {
          for (const decision of routes) {
            if (decision.kind === 're_chase') {
              await deps.routeReChase(decision);
            } else if (decision.kind === 'attorney_review') {
              await deps.openAttorneyReview(decision);
            }
          }
          await deps.emitAudit({
            action: 'chain.routed',
            dealId,
            status: analysis.status,
            breakCount: analysis.breaks.length,
            reChaseCount,
            attorneyReviewCount,
          });
        });
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return { dealId, status: analysis.status, breaks: analysis.breaks, routes };
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
