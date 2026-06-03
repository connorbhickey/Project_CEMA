import { describe, expect, it } from 'vitest';

import { INTERNAL_FIXTURES } from './fixtures';
import { INTERNAL_SCORERS, runNotify } from './scorers';

describe('Internal-Comms offline compliance gate', () => {
  it.each(INTERNAL_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runNotify(fixture.input);
    for (const scorer of INTERNAL_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
