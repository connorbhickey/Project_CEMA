/**
 * Human labels for chain-of-title break kinds, shown on the chain-of-title review
 * queue. Drift-guarded in the test vs the agent's exported BREAK_KINDS so a new
 * kind can't lose a label.
 */
export const CHAIN_BREAK_KIND_LABELS = {
  missing_assignment: 'Missing Assignment',
  lost_note: 'Lost Note',
  ambiguous_assignment: 'Ambiguous Assignment',
  unrecorded_instrument: 'Unrecorded Instrument',
} as const;

/** Display label for a chain-break kind, or the raw token if unknown. */
export function chainBreakKindLabel(kind: string): string {
  return (CHAIN_BREAK_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}
