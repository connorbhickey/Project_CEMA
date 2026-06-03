import type { DocumentKind } from '@cema/collateral';

import type { DealDocGenInput } from '../src/types';

export interface DocGenFixture {
  readonly name: string;
  readonly input: DealDocGenInput;
  readonly expected: {
    readonly ok: boolean;
    readonly issues: readonly string[];
    readonly kinds: readonly DocumentKind[];
    readonly gap: number;
  };
}

// Synthetic borrower names — the no-pii-leak scorer asserts these never appear in
// any planned document's field-map (hard rule #3).
const NAMES = ['Jane Q. Borrower', 'John P. Coborrower'] as const;

const CORE: readonly DocumentKind[] = [
  'cema_3172',
  'consolidated_note',
  'aff_255',
  'aff_275',
  'mt_15',
];

// Independent restatement of the planner's emit rule (a regression guard, not a
// copy of the implementation): core set, gap docs only when gap > 0, one aom per
// existing loan. The plan-completeness scorer compares real output to this.
function consistentKinds(loanCount: number, gapPositive: boolean): DocumentKind[] {
  return [
    ...CORE,
    ...(gapPositive ? (['gap_note', 'gap_mortgage'] as DocumentKind[]) : []),
    ...Array<DocumentKind>(loanCount).fill('aom'),
  ];
}

function loans(...upbs: number[]): ReadonlyArray<{ id: string; upb: number }> {
  return upbs.map((upb, i) => ({ id: `loan-${i + 1}`, upb }));
}

function fx(
  name: string,
  input: Omit<DealDocGenInput, 'borrowerNames'>,
  expected: DocGenFixture['expected'],
): DocGenFixture {
  return { name, input: { ...input, borrowerNames: [...NAMES] }, expected };
}

export const DOC_GEN_FIXTURES: readonly DocGenFixture[] = [
  // --- Consistent Refi-CEMA plans (ok) ---
  fx(
    'single loan, new money',
    {
      dealId: 'dg-01',
      cemaType: 'refi_cema',
      newPrincipal: 500000,
      existingLoans: loans(300000),
      county: 'Queens',
    },
    { ok: true, issues: [], kinds: consistentKinds(1, true), gap: 200000 },
  ),
  fx(
    'single loan, no new money (gap 0)',
    {
      dealId: 'dg-02',
      cemaType: 'refi_cema',
      newPrincipal: 300000,
      existingLoans: loans(300000),
      county: 'Kings',
    },
    { ok: true, issues: [], kinds: consistentKinds(1, false), gap: 0 },
  ),
  fx(
    'two loans, new money',
    {
      dealId: 'dg-03',
      cemaType: 'refi_cema',
      newPrincipal: 600000,
      existingLoans: loans(200000, 250000),
      county: 'New York',
    },
    { ok: true, issues: [], kinds: consistentKinds(2, true), gap: 150000 },
  ),
  fx(
    'two loans, gap 0',
    {
      dealId: 'dg-04',
      cemaType: 'refi_cema',
      newPrincipal: 450000,
      existingLoans: loans(200000, 250000),
      county: 'Bronx',
    },
    { ok: true, issues: [], kinds: consistentKinds(2, false), gap: 0 },
  ),
  fx(
    'three loans, new money',
    {
      dealId: 'dg-05',
      cemaType: 'refi_cema',
      newPrincipal: 1000000,
      existingLoans: loans(300000, 300000, 200000),
      county: 'Richmond',
    },
    { ok: true, issues: [], kinds: consistentKinds(3, true), gap: 200000 },
  ),
  fx(
    'tiny gap above zero',
    {
      dealId: 'dg-06',
      cemaType: 'refi_cema',
      newPrincipal: 300000.01,
      existingLoans: loans(300000),
      county: 'Queens',
    },
    { ok: true, issues: [], kinds: consistentKinds(1, true), gap: 0.01 },
  ),
  fx(
    'decimals that tie to zero',
    {
      dealId: 'dg-07',
      cemaType: 'refi_cema',
      newPrincipal: 333333.33,
      existingLoans: loans(333333.33),
      county: 'Kings',
    },
    { ok: true, issues: [], kinds: consistentKinds(1, false), gap: 0 },
  ),
  fx(
    'large new money',
    {
      dealId: 'dg-08',
      cemaType: 'refi_cema',
      newPrincipal: 2500000,
      existingLoans: loans(1800000),
      county: 'New York',
    },
    { ok: true, issues: [], kinds: consistentKinds(1, true), gap: 700000 },
  ),
  fx(
    'four loans, gap 0',
    {
      dealId: 'dg-09',
      cemaType: 'refi_cema',
      newPrincipal: 800000,
      existingLoans: loans(200000, 200000, 200000, 200000),
      county: 'Queens',
    },
    { ok: true, issues: [], kinds: consistentKinds(4, false), gap: 0 },
  ),
  fx(
    'large gap single loan',
    {
      dealId: 'dg-10',
      cemaType: 'refi_cema',
      newPrincipal: 1000000,
      existingLoans: loans(250000),
      county: 'Bronx',
    },
    { ok: true, issues: [], kinds: consistentKinds(1, true), gap: 750000 },
  ),
  fx(
    'two uneven loans with decimals',
    {
      dealId: 'dg-11',
      cemaType: 'refi_cema',
      newPrincipal: 525000.5,
      existingLoans: loans(100000.25, 200000.25),
      county: 'New York',
    },
    { ok: true, issues: [], kinds: consistentKinds(2, true), gap: 225000 },
  ),
  fx(
    'small loan, new money',
    {
      dealId: 'dg-12',
      cemaType: 'refi_cema',
      newPrincipal: 150000,
      existingLoans: loans(50000),
      county: 'Kings',
    },
    { ok: true, issues: [], kinds: consistentKinds(1, true), gap: 100000 },
  ),
  fx(
    'three loans, gap 0',
    {
      dealId: 'dg-13',
      cemaType: 'refi_cema',
      newPrincipal: 600000,
      existingLoans: loans(200000, 200000, 200000),
      county: 'Richmond',
    },
    { ok: true, issues: [], kinds: consistentKinds(3, false), gap: 0 },
  ),
  fx(
    'modest gap single loan',
    {
      dealId: 'dg-14',
      cemaType: 'refi_cema',
      newPrincipal: 425000,
      existingLoans: loans(375000),
      county: 'Bronx',
    },
    { ok: true, issues: [], kinds: consistentKinds(1, true), gap: 50000 },
  ),
  // --- Inconsistent inputs (no documents emitted) ---
  fx(
    'purchase CEMA is out of scope',
    {
      dealId: 'dg-15',
      cemaType: 'purchase_cema',
      newPrincipal: 500000,
      existingLoans: loans(300000),
      county: 'Queens',
    },
    { ok: false, issues: ['not_refi_cema'], kinds: [], gap: 200000 },
  ),
  fx(
    'no existing loans',
    {
      dealId: 'dg-16',
      cemaType: 'refi_cema',
      newPrincipal: 400000,
      existingLoans: loans(),
      county: 'Kings',
    },
    { ok: false, issues: ['no_existing_loans'], kinds: [], gap: 400000 },
  ),
  fx(
    'new principal zero (also fails to tie)',
    {
      dealId: 'dg-17',
      cemaType: 'refi_cema',
      newPrincipal: 0,
      existingLoans: loans(300000),
      county: 'New York',
    },
    {
      ok: false,
      issues: ['new_principal_not_positive', 'numbers_do_not_tie'],
      kinds: [],
      gap: -300000,
    },
  ),
  fx(
    'new principal negative',
    {
      dealId: 'dg-18',
      cemaType: 'refi_cema',
      newPrincipal: -100,
      existingLoans: loans(100000),
      county: 'Bronx',
    },
    {
      ok: false,
      issues: ['new_principal_not_positive', 'numbers_do_not_tie'],
      kinds: [],
      gap: -100100,
    },
  ),
  fx(
    'numbers do not tie (gap negative)',
    {
      dealId: 'dg-19',
      cemaType: 'refi_cema',
      newPrincipal: 200000,
      existingLoans: loans(300000),
      county: 'Queens',
    },
    { ok: false, issues: ['numbers_do_not_tie'], kinds: [], gap: -100000 },
  ),
  fx(
    'two loans, numbers do not tie',
    {
      dealId: 'dg-20',
      cemaType: 'refi_cema',
      newPrincipal: 400000,
      existingLoans: loans(250000, 250000),
      county: 'Kings',
    },
    { ok: false, issues: ['numbers_do_not_tie'], kinds: [], gap: -100000 },
  ),
  fx(
    'purchase + no loans + zero principal (multi-issue)',
    {
      dealId: 'dg-21',
      cemaType: 'purchase_cema',
      newPrincipal: 0,
      existingLoans: loans(),
      county: 'New York',
    },
    {
      ok: false,
      issues: ['not_refi_cema', 'no_existing_loans', 'new_principal_not_positive'],
      kinds: [],
      gap: 0,
    },
  ),
  fx(
    'purchase that also does not tie',
    {
      dealId: 'dg-22',
      cemaType: 'purchase_cema',
      newPrincipal: 100000,
      existingLoans: loans(200000),
      county: 'Bronx',
    },
    { ok: false, issues: ['not_refi_cema', 'numbers_do_not_tie'], kinds: [], gap: -100000 },
  ),
];
