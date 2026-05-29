import { describe, expect, it } from 'vitest';

import type { NormalizedApplication, SavingsEstimate } from '../src/types';

import {
  NARRATIVE_SCORERS,
  groundedInProvidedFigures,
  hasLegalDisclosure,
  mentionsNetSavings,
  placeholderCaveatConsistency,
  withinSentenceBudget,
  type NarrativeEvalInput,
} from './scorers';

function app(overrides: Partial<NormalizedApplication> = {}): NormalizedApplication {
  return {
    externalId: 'LOS-TEST',
    cemaType: 'refi_cema',
    state: 'NY',
    propertyType: 'single_family',
    loanProgram: 'conventional',
    lienPosition: 1,
    existingUpb: 400_000,
    newLoanAmount: 500_000,
    county: 'Kings',
    ...overrides,
  };
}

function savings(overrides: Partial<SavingsEstimate> = {}): SavingsEstimate {
  return {
    assignedUpb: 400_000,
    appliedRate: 0.02,
    taxSaved: 8_000,
    fees: 1_000,
    netSavings: 7_000,
    isPlaceholderRate: false,
    ...overrides,
  };
}

function input(
  s: Partial<SavingsEstimate> = {},
  a: Partial<NormalizedApplication> = {},
): NarrativeEvalInput {
  return { application: app(a), savings: savings(s) };
}

describe('mentionsNetSavings', () => {
  it('scores 1 when the rounded net-savings figure appears (comma-formatted)', () => {
    expect(
      mentionsNetSavings({ input: input({ netSavings: 7_000 }), output: 'You save $7,000.' }).score,
    ).toBe(1);
  });

  it('scores 1 for a bare, un-formatted figure', () => {
    expect(
      mentionsNetSavings({ input: input({ netSavings: 16_500 }), output: 'Net savings 16500.' })
        .score,
    ).toBe(1);
  });

  it('scores 0 when the figure is absent', () => {
    expect(
      mentionsNetSavings({ input: input({ netSavings: 7_000 }), output: 'You save a lot.' }).score,
    ).toBe(0);
  });

  it('rounds fractional net savings before matching', () => {
    // 2774.5 → Math.round → 2775; the comma-formatted "$2,775" normalizes to "2775".
    expect(
      mentionsNetSavings({ input: input({ netSavings: 2_774.5 }), output: 'You save $2,775.' })
        .score,
    ).toBe(1);
  });
});

describe('groundedInProvidedFigures', () => {
  const s = { assignedUpb: 400_000, taxSaved: 8_000, fees: 1_000, netSavings: 7_000 };

  it('scores 1 when every cited figure is one the estimate provided', () => {
    const output =
      'You save $7,000: $8,000 of recording tax avoided on $400,000 UPB, net of $1,000 in fees.';
    expect(groundedInProvidedFigures({ input: input(s), output }).score).toBe(1);
  });

  it('scores the grounded fraction when a figure is invented', () => {
    const output = 'You save $7,000 — plus a mysterious $9,999 bonus.';
    expect(groundedInProvidedFigures({ input: input(s), output }).score).toBe(0.5);
  });

  it('scores 1 when the narrative cites no money at all', () => {
    expect(
      groundedInProvidedFigures({ input: input(s), output: 'A CEMA can lower your costs.' }).score,
    ).toBe(1);
  });

  it('ignores small bare numbers (§255, rates, lien position)', () => {
    const output = 'Under §255, your first-lien (position 1) CEMA at a 2% rate saves $7,000.';
    expect(groundedInProvidedFigures({ input: input(s), output }).score).toBe(1);
  });
});

describe('hasLegalDisclosure', () => {
  it('scores 1 when the no-legal-advice disclosure is present', () => {
    expect(
      hasLegalDisclosure({
        input: input(),
        output: 'This is informational only and is not legal or tax advice.',
      }).score,
    ).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(hasLegalDisclosure({ input: input(), output: 'Not Legal Or Tax Advice.' }).score).toBe(
      1,
    );
  });

  it('scores 0 when the disclosure is missing', () => {
    expect(hasLegalDisclosure({ input: input(), output: 'You should refinance now.' }).score).toBe(
      0,
    );
  });
});

describe('placeholderCaveatConsistency', () => {
  it('scores 1 for a confirmed rate regardless of caveat wording', () => {
    expect(
      placeholderCaveatConsistency({
        input: input({ isPlaceholderRate: false }),
        output: 'Your savings are $7,000.',
      }).score,
    ).toBe(1);
  });

  it('scores 1 when a placeholder rate is flagged as preliminary', () => {
    expect(
      placeholderCaveatConsistency({
        input: input({ isPlaceholderRate: true }),
        output: 'These are preliminary figures and may change.',
      }).score,
    ).toBe(1);
  });

  it('scores 0 when a placeholder rate is presented as final', () => {
    expect(
      placeholderCaveatConsistency({
        input: input({ isPlaceholderRate: true }),
        output: 'Your savings are locked in at $7,000.',
      }).score,
    ).toBe(0);
  });
});

describe('withinSentenceBudget', () => {
  it('scores 1 for five or fewer sentences', () => {
    expect(
      withinSentenceBudget({ input: input(), output: 'One. Two. Three! Four? Five.' }).score,
    ).toBe(1);
  });

  it('scores 0 for more than five sentences', () => {
    expect(
      withinSentenceBudget({ input: input(), output: 'One. Two. Three. Four. Five. Six.' }).score,
    ).toBe(0);
  });
});

describe('NARRATIVE_SCORERS', () => {
  it('exposes all five scorers in eval order', () => {
    expect(NARRATIVE_SCORERS).toHaveLength(5);
    expect(NARRATIVE_SCORERS.map((scorer) => scorer.name)).toEqual([
      'mentionsNetSavings',
      'groundedInProvidedFigures',
      'hasLegalDisclosure',
      'placeholderCaveatConsistency',
      'withinSentenceBudget',
    ]);
  });
});
