import { GATE_REQUIRED_KINDS, type DocumentKind } from '@cema/collateral';

import { planRecording } from '../src/plan';
import type { DealRecordingInput, RecordingPlan } from '../src/types';

import type { RecordingFixture } from './fixtures';

export type RecordingExpected = RecordingFixture['expected'];

export interface RecordingScorerArgs {
  readonly input: DealRecordingInput;
  readonly expected: RecordingExpected;
  readonly output: RecordingPlan;
}

export interface RecordingScore {
  readonly name: string;
  readonly score: number;
}

const GATE_SET = new Set<DocumentKind>(GATE_REQUIRED_KINDS);
const sortedJoin = (xs: readonly string[]): string => [...xs].sort().join(',');

// 1) Venue + borough resolution matches (BBL digit wins, then county-name
//    fallback, else upstate county clerk with a null borough).
function venueCorrect({ output, expected }: RecordingScorerArgs): RecordingScore {
  const ok = output.venue === expected.venue && output.borough === expected.borough;
  return { name: 'venue-correct', score: ok ? 1 : 0 };
}

// 2) The emitted cover-sheet kind multiset matches expected (venue x CEMA-type).
function coverSheetsCorrect({ output, expected }: RecordingScorerArgs): RecordingScore {
  const got = sortedJoin(output.coverSheets.map((c) => c.kind));
  const want = sortedJoin(expected.kinds);
  return { name: 'cover-sheets-correct', score: got === want ? 1 : 0 };
}

// 3) MIXED attorney-gate (hard rule #2). Unlike Doc-Gen (every kind gated), this
//    agent emits a mix -- county_cover_sheet IS gate-required; acris_cover_pages,
//    nyc_rpt, tp_584 are NOT. Each sheet's flag must equal GATE_REQUIRED_KINDS.
function attorneyGateCorrect({ output }: RecordingScorerArgs): RecordingScore {
  const ok = output.coverSheets.every((c) => c.attorneyReviewRequired === GATE_SET.has(c.kind));
  return { name: 'attorney-gate-correct', score: ok ? 1 : 0 };
}

// 4) No PII in the cover-sheet field-maps (hard rule #3): field keys stay within
//    a PII-free allowlist and no string value is SSN- or account-number-shaped.
//    (Recording input carries no borrower name, so the invariant is structural.)
const FIELD_KEY_ALLOWLIST = new Set(['dealId', 'venue', 'county', 'total']);
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const LONG_DIGIT_RUN = /\d{7,}/;
function noPiiLeak({ output }: RecordingScorerArgs): RecordingScore {
  const leaked = output.coverSheets.some((c) =>
    Object.entries(c.fields).some(([k, v]) => {
      if (!FIELD_KEY_ALLOWLIST.has(k)) return true;
      if (typeof v !== 'string') return false;
      return SSN.test(v) || LONG_DIGIT_RUN.test(v);
    }),
  );
  return { name: 'no-pii-leak', score: leaked ? 0 : 1 };
}

// 5) The placeholder fee total ties out (base + per-page*pages + flat county).
function feeCorrect({ output, expected }: RecordingScorerArgs): RecordingScore {
  return { name: 'fee-correct', score: output.fees.total === expected.total ? 1 : 0 };
}

export const RECORDING_SCORERS = [
  venueCorrect,
  coverSheetsCorrect,
  attorneyGateCorrect,
  noPiiLeak,
  feeCorrect,
] as const;

export function runPlan(input: DealRecordingInput): RecordingPlan {
  return planRecording(input);
}
