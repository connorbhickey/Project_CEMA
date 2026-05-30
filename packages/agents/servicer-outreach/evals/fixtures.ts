import type { DraftEmailInput } from '../src/draft';

// 5 servicers (incl. the null/unknown case) x 5 touch numbers = 25 fixtures.
// Deal references are opaque tokens (one includes a UUID-style digit run to
// exercise the no_pii_leak strip).
const SERVICERS: (string | null)[] = [
  'Acme Loan Servicing',
  'Nationstar Mortgage',
  'Cenlar FSB',
  'Mr. Cooper',
  null,
];

const DEAL_REFERENCES = [
  'deal-acme-0001',
  'deal-nationstar-0002',
  'deal-cenlar-0003',
  '550e8400-e29b-41d4-a716-446655440000',
  'deal-unknown-0005',
];

export const OUTREACH_FIXTURES: DraftEmailInput[] = SERVICERS.flatMap((servicerName, i) =>
  [1, 2, 3, 4, 5].map((touchNumber) => ({
    servicerName,
    touchNumber,
    dealReference: DEAL_REFERENCES[i]!,
  })),
);
