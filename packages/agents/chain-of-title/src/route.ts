import { BREAK_KINDS } from './types';
import type { BreakKind, ChainBreak, RouteDecision, RouteKind } from './types';

// Static break -> route map. missing_assignment is recoverable by chasing the
// servicer for the missing instrument; the other three need a lawyer.
const ROUTE_BY_BREAK: Record<BreakKind, RouteKind> = {
  missing_assignment: 're_chase',
  lost_note: 'attorney_review',
  ambiguous_assignment: 'attorney_review',
  unrecorded_instrument: 'attorney_review',
};

// PII-free reason templates -- safe to persist and surface to a processor.
// NOTE: a ChainBreak.detail may name parties; we deliberately do NOT use it here.
const REASON_BY_BREAK: Record<BreakKind, string> = {
  missing_assignment:
    'A gap in the recorded assignment sequence was detected; re-chase the servicer for the missing assignment.',
  lost_note:
    'A promissory note has no anchoring mortgage; attorney review required (possible lost-note affidavit).',
  ambiguous_assignment:
    'The recorded assignment graph is ambiguous (missing party, fork, merge, or cycle); attorney review required.',
  unrecorded_instrument:
    'An instrument that must be recorded carries no recording reference; attorney review required.',
};

// Exhaustiveness guard: if BREAK_KINDS gains a member the maps don't cover,
// this throws at module load rather than silently routing undefined.
for (const kind of BREAK_KINDS) {
  if (!(kind in ROUTE_BY_BREAK) || !(kind in REASON_BY_BREAK)) {
    throw new Error(`route maps are missing an entry for break kind "${kind}"`);
  }
}

/**
 * Map each classified break to a routing decision. A clean chain (zero breaks)
 * yields a single advisory_pass. PURE: no IO, no clock. PII-safe -- the
 * ChainBreak.detail (which may carry party names) is never propagated.
 */
export function route(dealId: string, breaks: readonly ChainBreak[]): RouteDecision[] {
  if (breaks.length === 0) {
    return [
      {
        dealId,
        kind: 'advisory_pass',
        breakKind: null,
        documentId: null,
        reason: 'Chain of title is internally consistent; advisory pass.',
      },
    ];
  }
  return breaks.map((b) => ({
    dealId,
    kind: ROUTE_BY_BREAK[b.kind],
    breakKind: b.kind,
    documentId: b.documentId,
    reason: REASON_BY_BREAK[b.kind],
  }));
}
