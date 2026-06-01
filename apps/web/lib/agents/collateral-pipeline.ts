'use server';

import type { ChainResult } from '@cema/agents-chain-of-title';
import type { OutreachResult } from '@cema/agents-servicer-outreach';
import { redactPii } from '@cema/compliance';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import { indexDealInstrumentEdges } from '../kg/index-deal-instrument-edges';

import { runChainOfTitleFromDeal } from './chain-of-title/run-chain-of-title-action';
import { runCollateralIdpFromDeal } from './collateral-idp/run-collateral-idp-action';
import { hasReChase, type CollateralPipelineResult } from './collateral-pipeline-core';
import { runOutreachFromDeal } from './servicer-outreach/run-outreach-action';

const tracer = trace.getTracer('@cema/web-collateral-pipeline');

/**
 * Composes the three collateral agents into the natural document flow:
 *
 *   IDP  →  (if ≥1 doc classified)  Chain-of-Title  →  (if re_chase)  Outreach
 *
 * Each stage is an existing session-backed Server Action, so identity/RLS is
 * resolved once per stage from the Clerk session of the caller. The pipeline
 * PROPAGATES errors — the best-effort "never block the status write" policy
 * lives one layer up in the deal-status dispatcher, not here.
 *
 * Span attributes are PII-safe by construction: dealId, document counts, the
 * chain status enum, and booleans only — never party names, amounts, or any
 * `ChainBreak.detail`.
 */
export async function runCollateralPipeline(dealId: string): Promise<CollateralPipelineResult> {
  return tracer.startActiveSpan('pipeline.collateral', async (span) => {
    span.setAttribute('pipeline.deal_id', dealId);
    try {
      const idp = await runCollateralIdpFromDeal(dealId);
      span.setAttribute('pipeline.idp_document_count', idp.documents.length);

      let chain: ChainResult | null = null;
      let outreach: OutreachResult | null = null;

      if (idp.documents.length > 0) {
        // Index the deal's classified instruments into the KG as PII-safe
        // deal_has_instrument edges (idempotent). Independent of the chain
        // analysis — it only reads the IDP-written extractedData.
        const instrumentEdgeCount = await indexDealInstrumentEdges(dealId);
        span.setAttribute('pipeline.instrument_edge_count', instrumentEdgeCount);

        chain = await runChainOfTitleFromDeal(dealId);
        span.setAttribute('pipeline.chain_status', chain.status);

        if (hasReChase(chain)) {
          outreach = await runOutreachFromDeal(dealId);
        }
      }

      span.setAttribute('pipeline.chain_ran', chain !== null);
      span.setAttribute('pipeline.outreach_ran', outreach !== null);
      span.setStatus({ code: SpanStatusCode.OK });
      return { dealId, idp, chain, outreach };
    } catch (err) {
      const message = redactPii(err instanceof Error ? err.message : String(err));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw new Error(message);
    } finally {
      span.end();
    }
  });
}
