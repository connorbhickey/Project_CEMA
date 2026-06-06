export interface DocField {
  readonly label: string;
  readonly value: string;
}

// Keys never shown in the amount grid — ids, not figures.
const HIDDEN_KEYS = new Set(['dealId', 'existingLoanId']);

function humanize(key: string): string {
  // camelCase -> "Camel Case"
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Turn a Doc-Gen / Recording-Prep field-map (`documents.extractedData` for a
 * GENERATED document) into displayable label/value pairs, so the workspace can show
 * the computed amounts (gap, new principal, UPB totals, county, …) instead of just
 * the kind. Excludes ids; renders only string/number scalars.
 *
 * PII-safe (hard rule #3): a field-map carries amounts + county + public form
 * tokens, never a borrower name — the Doc-Gen `no-pii-leak` scorer enforces that
 * upstream. Amounts are loan figures already shown on the deal overview, not the
 * "payoff figures" the redaction rule guards (and this renders in the UI, not logs).
 * Returns null for a non-field-map (an instrument record, or an empty `{}`).
 */
export function generatedDocFields(extractedData: unknown): DocField[] | null {
  if (typeof extractedData !== 'object' || extractedData === null) return null;
  const obj = extractedData as Record<string, unknown>;

  const out: DocField[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (HIDDEN_KEYS.has(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    out.push({ label: humanize(key), value: String(value) });
  }
  return out.length > 0 ? out : null;
}
