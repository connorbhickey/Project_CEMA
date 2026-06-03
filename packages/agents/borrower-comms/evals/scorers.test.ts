import { describe, expect, it } from 'vitest';

import { BORROWER_FIXTURES } from './fixtures';
import { BORROWER_SCORERS, runNotify } from './scorers';

describe('Borrower-Comms offline compliance gate', () => {
  it.each(BORROWER_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runNotify(fixture.input);
    for (const scorer of BORROWER_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
