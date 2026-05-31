import { describe, expect, it } from 'vitest';

import { CHAIN_FIXTURES } from './fixtures';
import { CHAIN_SCORERS, runPipeline } from './scorers';

describe('chain-of-title offline scorers', () => {
  it.each(CHAIN_FIXTURES)('$name scores 1.0 on every scorer', (fixture) => {
    const output = runPipeline(fixture.instruments);
    for (const { name, scorer } of CHAIN_SCORERS) {
      const score = scorer({ output, expected: fixture.expected });
      expect(score, `${fixture.name} / ${name}`).toBe(1);
    }
  });

  it('noFalseClean catches a fabricated false-clean output', () => {
    const safety = CHAIN_SCORERS.find((s) => s.name === 'no_false_clean');
    expect(safety).toBeDefined();
    const score = safety!.scorer({
      output: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
      expected: { status: 'broken', breakKinds: ['missing_assignment'], routeKinds: ['re_chase'] },
    });
    expect(score).toBe(0);
  });
});
