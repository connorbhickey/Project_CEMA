/**
 * Pure scorers for the borrower-facing savings-narrative eval (plan Task 8).
 *
 * Kept separate from the Braintrust `Eval()` wiring in `savings-narrative.eval.ts`
 * so the compliance-bearing checks — figures grounded in the provided estimate,
 * the §255 preliminary caveat, the no-legal-advice disclosure — are deterministic
 * pure functions that the `Unit tests` CI job verifies on every run, with no model
 * call and no API key (`scorers.test.ts`). The live model is the only
 * non-deterministic part of the eval, and it runs only when keys are provisioned.
 *
 * Each scorer matches Braintrust's custom-scorer signature
 * (`(args: { input, output }) => { name, score }`) so it can be dropped straight
 * into the `scores` array.
 */

import type { NormalizedApplication, SavingsEstimate } from '../src/types';

/** The unit a single eval case feeds to the narrative model. */
export interface NarrativeEvalInput {
  application: NormalizedApplication;
  savings: SavingsEstimate;
}

/** Braintrust score: a named value in [0, 1]. */
export interface NarrativeScore {
  name: string;
  score: number;
}

interface ScorerArgs {
  input: NarrativeEvalInput;
  output: string;
}

/**
 * Money-like tokens we hold to the "no invented figures" rule: a `$`-prefixed
 * amount, or a bare run of 4+ digits (i.e. >= 1,000). Deliberately ignores small
 * bare numbers so legitimate non-dollar references — `§255`, lien position `1`,
 * "2-3 sentences", a `2%` rate — never count as ungrounded figures.
 */
const MONEY_TOKEN = /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]{3,}(?:\.\d+)?\b/g;

function moneyAmounts(text: string): number[] {
  const matches = text.match(MONEY_TOKEN) ?? [];
  return matches
    .map((m) => Math.round(Number(m.replace(/[$,\s]/g, ''))))
    .filter((n) => Number.isFinite(n) && n >= 1000);
}

/** The narrative must surface the headline net-savings figure. */
export function mentionsNetSavings({ input, output }: ScorerArgs): NarrativeScore {
  const target = String(Math.round(input.savings.netSavings));
  const normalized = output.replace(/,/g, '');
  return { name: 'mentions_net_savings', score: normalized.includes(target) ? 1 : 0 };
}

/**
 * Every money figure in the narrative must be one the estimate actually provided
 * — the core anti-hallucination guardrail. Graded: the fraction of money tokens
 * that are grounded (1 when the narrative cites no money at all).
 */
export function groundedInProvidedFigures({ input, output }: ScorerArgs): NarrativeScore {
  const allowed = new Set(
    [
      input.savings.assignedUpb,
      input.savings.taxSaved,
      input.savings.fees,
      input.savings.netSavings,
    ].map((n) => Math.round(n)),
  );
  const cited = moneyAmounts(output);
  if (cited.length === 0) {
    return { name: 'grounded_in_provided_figures', score: 1 };
  }
  const grounded = cited.filter((n) => allowed.has(n)).length;
  return { name: 'grounded_in_provided_figures', score: grounded / cited.length };
}

/** Attorney-supervised posture (hard rule #2): the no-legal-advice disclosure. */
export function hasLegalDisclosure({ output }: ScorerArgs): NarrativeScore {
  return { name: 'has_legal_disclosure', score: /legal or tax advice/i.test(output) ? 1 : 0 };
}

/**
 * When the estimate used a placeholder (non-confirmed) recording-tax rate, the
 * narrative must flag the figures as preliminary; when the rate is confirmed
 * there is nothing to require, so it always scores 1.
 */
export function placeholderCaveatConsistency({ input, output }: ScorerArgs): NarrativeScore {
  const name = 'placeholder_caveat_consistency';
  if (!input.savings.isPlaceholderRate) {
    return { name, score: 1 };
  }
  const flagsPreliminary =
    /preliminary|estimate|may change|subject to change|not.{0,12}confirmed/i.test(output);
  return { name, score: flagsPreliminary ? 1 : 0 };
}

/** Quality signal: the prompt asks for 2-3 sentences; allow the caveat + disclosure. */
export function withinSentenceBudget({ output }: ScorerArgs): NarrativeScore {
  const sentences = output
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { name: 'within_sentence_budget', score: sentences.length <= 5 ? 1 : 0 };
}

/** All scorers, in the order they appear in the eval's `scores` array. */
export const NARRATIVE_SCORERS = [
  mentionsNetSavings,
  groundedInProvidedFigures,
  hasLegalDisclosure,
  placeholderCaveatConsistency,
  withinSentenceBudget,
];
