import { describe, expect, it } from 'vitest';

import { DOC_GEN_FIXTURES } from './fixtures';
import { DOC_GEN_SCORERS, runPlan } from './scorers';

describe('Doc-Gen offline compliance gate', () => {
  it.each(DOC_GEN_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runPlan(fixture.input);
    for (const scorer of DOC_GEN_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
