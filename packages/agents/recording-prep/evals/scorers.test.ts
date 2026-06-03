import { describe, expect, it } from 'vitest';

import { RECORDING_FIXTURES } from './fixtures';
import { RECORDING_SCORERS, runPlan } from './scorers';

describe('Recording-Prep offline compliance gate', () => {
  it.each(RECORDING_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runPlan(fixture.input);
    for (const scorer of RECORDING_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
