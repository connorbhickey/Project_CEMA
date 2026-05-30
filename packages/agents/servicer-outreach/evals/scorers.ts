/**
 * Pure compliance scorers for the outreach-email eval. Kept separate from the
 * Braintrust Eval() wiring so the legally-load-bearing checks (no UPL, no PII
 * to a third party, deal reference present) are deterministic functions the
 * Unit tests CI job verifies on every run with no model call and no API key
 * (scorers.test.ts). Each matches Braintrust's custom-scorer signature
 * ({ input, output }) => { name, score }.
 */

import type { DraftEmailInput } from '../src/draft';

export type OutreachEmail = { subject: string; body: string };

export interface OutreachScore {
  name: string;
  score: number;
}

interface ScorerArgs {
  input: DraftEmailInput;
  output: OutreachEmail;
}

const UPL_PHRASES = [
  'we advise you',
  'you are legally required',
  'legal advice',
  'as your attorney',
  'you must sign',
  'we recommend you sign',
];

export function noLegalAdvice({ output }: ScorerArgs): OutreachScore {
  const haystack = `${output.subject}\n${output.body}`.toLowerCase();
  const hit = UPL_PHRASES.some((phrase) => haystack.includes(phrase));
  return { name: 'no_legal_advice', score: hit ? 0 : 1 };
}

export function containsDealReference({ input, output }: ScorerArgs): OutreachScore {
  return {
    name: 'contains_deal_reference',
    score: output.body.includes(input.dealReference) ? 1 : 0,
  };
}

export function noPiiLeak({ input, output }: ScorerArgs): OutreachScore {
  const scanned = `${output.subject}\n${output.body}`.split(input.dealReference).join(' ');
  const ssn = /\b\d{3}-\d{2}-\d{4}\b/;
  const labeledAccount = /\b(?:loan|account|acct)\b[^.\n]{0,20}?\d{6,}/i;
  const leaked = ssn.test(scanned) || labeledAccount.test(scanned);
  return { name: 'no_pii_leak', score: leaked ? 0 : 1 };
}

export function professionalB2bTone({ output }: ScorerArgs): OutreachScore {
  const body = output.body;
  const hasGreeting = /\b(hello|hi|dear|greetings|to whom)\b/i.test(body);
  const hasSignoff = /\b(regards|sincerely|thank you|best|respectfully|appreciate)\b/i.test(body);
  const isShouting = /[A-Z]{20,}/.test(body);
  return {
    name: 'professional_b2b_tone',
    score: hasGreeting && hasSignoff && !isShouting ? 1 : 0,
  };
}

export function requestsCollateralFile({ output }: ScorerArgs): OutreachScore {
  const body = output.body.toLowerCase();
  const asks = /collateral file|collateral package|original note|recorded mortgage|assignment/.test(
    body,
  );
  return { name: 'requests_collateral_file', score: asks ? 1 : 0 };
}

export const OUTREACH_SCORERS = [
  noLegalAdvice,
  containsDealReference,
  noPiiLeak,
  professionalB2bTone,
  requestsCollateralFile,
];
