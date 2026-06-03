import type { InternalNotification } from '../src/types';

export interface InternalFixture {
  readonly name: string;
  readonly input: string; // a deal_status value (or an unknown string)
  readonly expected: { readonly message: InternalNotification['message'] } | null;
}

export const INTERNAL_FIXTURES: readonly InternalFixture[] = [
  // --- Notify statuses (channel is always 'pipeline') ---
  {
    name: 'authorization notifies',
    input: 'authorization',
    expected: { message: 'A deal is awaiting borrower authorization to proceed.' },
  },
  {
    name: 'collateral_chase notifies',
    input: 'collateral_chase',
    expected: { message: 'A deal is awaiting the collateral file from the prior servicer.' },
  },
  {
    name: 'attorney_review notifies',
    input: 'attorney_review',
    expected: {
      message: 'A deal has entered attorney review and is ready for an attorney to act.',
    },
  },
  {
    name: 'exception notifies',
    input: 'exception',
    expected: { message: 'A deal has been flagged as an exception and needs attention.' },
  },
  // --- Non-notify deal_status values -> null ---
  { name: 'intake is silent', input: 'intake', expected: null },
  { name: 'eligibility is silent', input: 'eligibility', expected: null },
  { name: 'title_work is silent', input: 'title_work', expected: null },
  { name: 'doc_prep is silent', input: 'doc_prep', expected: null },
  { name: 'closing is silent', input: 'closing', expected: null },
  { name: 'recording is silent', input: 'recording', expected: null },
  { name: 'completed is silent', input: 'completed', expected: null },
  { name: 'cancelled is silent', input: 'cancelled', expected: null },
  // --- Unknown string -> null ---
  { name: 'unknown status is silent', input: 'totally_unknown_status', expected: null },
];
