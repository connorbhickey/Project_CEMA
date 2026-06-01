import type { ChainBreakReviewState } from '@cema/attorney';

export interface ChainBreakAuditMetadata {
  readonly source: 'chain-of-title';
  readonly breakHash: string;
  readonly breakKind: string;
  readonly fromState: string;
  readonly toState: string;
}

/**
 * PII-safe audit metadata for a chain-break review transition. Pure + node-
 * testable (no Server-Action mocking), and the structural guarantee behind the
 * "note never audited" invariant: the parameter type accepts ONLY breakHash +
 * breakKind, so the attorney's free-text resolution_note (which MAY carry party
 * names -- hard rule #3) cannot flow into an audit event or an OTel span
 * attribute through this path.
 */
export function chainBreakAuditMetadata(
  row: { breakHash: string; breakKind: string },
  fromState: ChainBreakReviewState,
  toState: ChainBreakReviewState,
): ChainBreakAuditMetadata {
  return {
    source: 'chain-of-title',
    breakHash: row.breakHash,
    breakKind: row.breakKind,
    fromState,
    toState,
  };
}
