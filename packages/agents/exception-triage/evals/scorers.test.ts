import { describe, expect, it } from 'vitest';

import { TRIAGE_FIXTURES } from './fixtures';
import { TRIAGE_SCORERS, runTriage } from './scorers';

describe('Exception-Triage offline compliance gate', () => {
  it.each(TRIAGE_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runTriage(fixture.input);
    for (const scorer of TRIAGE_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
