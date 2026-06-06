import {
  EXCEPTION_KINDS,
  type DealSignals,
  type Exception,
  type ExceptionKind,
  type ExceptionRoute,
  type ExceptionSeverity,
} from './types';

// Static severity per exception kind.
const SEVERITY_BY_KIND: Record<ExceptionKind, ExceptionSeverity> = {
  chain_break: 'high',
  agent_dispatch_failed: 'medium',
  deal_flagged_exception: 'high',
  rejected_recording: 'high',
  purchase_missing_seller: 'medium',
};

// Static suggested route per exception kind (a pointer to the existing remedy).
const ROUTE_BY_KIND: Record<ExceptionKind, ExceptionRoute> = {
  chain_break: 'attorney_review',
  agent_dispatch_failed: 'reprocess',
  deal_flagged_exception: 'processor_review',
  rejected_recording: 'processor_review',
  purchase_missing_seller: 'processor_review',
};

// Static, PII-free reason per kind (no ids/counts/party names).
const REASON_BY_KIND: Record<ExceptionKind, string> = {
  chain_break: 'Chain-of-title breaks are awaiting attorney review.',
  agent_dispatch_failed:
    'A post-commit agent dispatch failed; re-run the collateral pipeline for this deal.',
  deal_flagged_exception: 'This deal is flagged as an exception and needs processor review.',
  rejected_recording: 'A recording submission was rejected and needs processor review.',
  purchase_missing_seller:
    'This Purchase CEMA has no seller party; add the seller before document generation.',
};

// Exhaustiveness guard: if EXCEPTION_KINDS gains a member the maps do not cover,
// throw at module load rather than silently routing undefined (mirrors
// ROUTE_BY_BREAK in @cema/agents-chain-of-title).
for (const kind of EXCEPTION_KINDS) {
  if (!(kind in SEVERITY_BY_KIND) || !(kind in ROUTE_BY_KIND) || !(kind in REASON_BY_KIND)) {
    throw new Error(`exception-triage maps are missing an entry for kind "${kind}"`);
  }
}

function make(kind: ExceptionKind): Exception {
  return {
    kind,
    severity: SEVERITY_BY_KIND[kind],
    route: ROUTE_BY_KIND[kind],
    reason: REASON_BY_KIND[kind],
  };
}

/**
 * Pure, deterministic exception classifier (spec §9.11). Derives the deal's
 * open exceptions from the live signals the other Layer-3 agents already emit.
 * No clock, no LLM, no IO. PII-safe by construction (enum tokens + static
 * reasons only). A clean deal yields an empty array.
 */
export function triageExceptions(signals: DealSignals): Exception[] {
  const out: Exception[] = [];
  if (signals.chainBreakCount > 0) out.push(make('chain_break'));
  if (signals.dispatchFailed) out.push(make('agent_dispatch_failed'));
  if (signals.dealStatus === 'exception') out.push(make('deal_flagged_exception'));
  if (signals.recordingRejected) out.push(make('rejected_recording'));
  if (signals.purchaseMissingSeller) out.push(make('purchase_missing_seller'));
  return out;
}
