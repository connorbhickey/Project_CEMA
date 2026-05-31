import { analyzeChain } from '../src/chain';
import { route } from '../src/route';
import type { BreakKind, ChainStatus, InstrumentRecord, RouteKind } from '../src/types';

import type { ChainFixture } from './fixtures';

export interface PipelineOutput {
  readonly status: ChainStatus;
  readonly breakKinds: readonly BreakKind[];
  readonly routeKinds: readonly RouteKind[];
}

export type ChainExpected = ChainFixture['expected'];

// The pipeline a fixture exercises: analyze then route, exactly as the
// orchestrator does (minus the injected effects).
export function runPipeline(instruments: readonly InstrumentRecord[]): PipelineOutput {
  const analysis = analyzeChain(instruments);
  const routes = route('eval-deal', analysis.breaks);
  return {
    status: analysis.status,
    breakKinds: analysis.breaks.map((b) => b.kind),
    routeKinds: routes.map((r) => r.kind),
  };
}

function sortedEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map(String).sort();
  const sb = [...b].map(String).sort();
  return sa.every((v, i) => v === sb[i]);
}

interface ScorerArgs {
  readonly output: PipelineOutput;
  readonly expected: ChainExpected;
}

export const statusCorrect = {
  name: 'status_correct',
  scorer: ({ output, expected }: ScorerArgs): number => (output.status === expected.status ? 1 : 0),
};

export const breakKindsCorrect = {
  name: 'break_kinds_correct',
  scorer: ({ output, expected }: ScorerArgs): number =>
    sortedEqual(output.breakKinds, expected.breakKinds) ? 1 : 0,
};

export const routeKindsCorrect = {
  name: 'route_kinds_correct',
  scorer: ({ output, expected }: ScorerArgs): number =>
    sortedEqual(output.routeKinds, expected.routeKinds) ? 1 : 0,
};

// The safety scorer ("never auto-bless"): a clean verdict is only acceptable
// when the fixture truly expects clean. Any clean output where the expectation
// is NOT clean scores 0 -- this is the property the whole agent exists to hold.
export const noFalseClean = {
  name: 'no_false_clean',
  scorer: ({ output, expected }: ScorerArgs): number => {
    if (output.status === 'clean' && expected.status !== 'clean') return 0;
    return 1;
  },
};

export const CHAIN_SCORERS = [statusCorrect, breakKindsCorrect, routeKindsCorrect, noFalseClean];
