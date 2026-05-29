import type { NormalizedApplication, RecordingTaxRateTable, SavingsEstimate } from './types';

/**
 * Non-authoritative placeholder rates (plan §6.1). The NY per-county mortgage-
 * recording-tax table is a legal/tax input only Connor can confirm; until then
 * every estimate carries isPlaceholderRate=true so no fabricated dollar figure
 * is ever presented to a borrower as authoritative.
 *
 * ratesByCounty is intentionally empty — we do not guess per-county rates — so
 * the flat defaultRate applies everywhere. These numbers are illustrative only.
 */
export const PLACEHOLDER_RATES: RecordingTaxRateTable = {
  isPlaceholder: true,
  ratesByCounty: {},
  defaultRate: 0.02,
  estimatedFees: 1_000,
};

/**
 * Deterministic recording-tax savings estimate (spec §9.3 step 5):
 * `assignedUpb × applicable rate − fees`. Pure — no I/O, no LLM. Table-driven so
 * the confirmed rate table is a config swap (plan §6.1, Decision 2).
 */
export function estimateSavings(
  app: NormalizedApplication,
  rates: RecordingTaxRateTable = PLACEHOLDER_RATES,
): SavingsEstimate {
  const assignedUpb = Math.max(0, app.existingUpb);
  const appliedRate = lookupRate(app.county, rates);
  const taxSaved = assignedUpb * appliedRate;
  const fees = rates.estimatedFees;

  return {
    assignedUpb,
    appliedRate,
    taxSaved,
    fees,
    netSavings: taxSaved - fees,
    isPlaceholderRate: rates.isPlaceholder,
  };
}

/** Case-insensitive county lookup; falls back to the table's defaultRate. */
function lookupRate(county: string, rates: RecordingTaxRateTable): number {
  const key = county.trim().toLowerCase();
  for (const [name, rate] of Object.entries(rates.ratesByCounty)) {
    if (name.toLowerCase() === key) {
      return rate;
    }
  }
  return rates.defaultRate;
}
