import type { BorrowerNotification } from '../src/types';

export interface BorrowerFixture {
  readonly name: string;
  readonly input: string; // a deal_status value (or an unknown string)
  readonly expected: {
    readonly subject: BorrowerNotification['subject'];
    readonly body: BorrowerNotification['body'];
  } | null;
}

export const BORROWER_FIXTURES: readonly BorrowerFixture[] = [
  // --- Borrower touchpoints (email only) ---
  {
    name: 'authorization emails the borrower',
    input: 'authorization',
    expected: {
      subject: 'Action needed on your CEMA',
      body: 'We need your authorization to proceed with your CEMA. Your processing team will follow up shortly with the details and next steps.',
    },
  },
  {
    name: 'closing emails the borrower',
    input: 'closing',
    expected: {
      subject: 'Your CEMA is scheduled to close',
      body: 'Good news — your CEMA is ready for closing. Your processing team will be in touch with the closing details and next steps.',
    },
  },
  {
    name: 'completed emails the borrower',
    input: 'completed',
    expected: {
      subject: 'Your CEMA is complete',
      body: 'Your CEMA has closed and been recorded. Thank you for working with us. Your processing team will send any final documentation.',
    },
  },
  // --- Non-touchpoint statuses -> null (NO borrower email) ---
  { name: 'intake does not email', input: 'intake', expected: null },
  { name: 'eligibility does not email', input: 'eligibility', expected: null },
  { name: 'collateral_chase does not email', input: 'collateral_chase', expected: null },
  { name: 'title_work does not email', input: 'title_work', expected: null },
  { name: 'doc_prep does not email', input: 'doc_prep', expected: null },
  { name: 'attorney_review does not email', input: 'attorney_review', expected: null },
  { name: 'recording does not email', input: 'recording', expected: null },
  // CRITICAL: a borrower must NEVER be emailed about an exception.
  { name: 'exception NEVER emails the borrower', input: 'exception', expected: null },
  { name: 'cancelled does not email', input: 'cancelled', expected: null },
  // --- Unknown string -> null ---
  { name: 'unknown status does not email', input: 'unknown', expected: null },
];
