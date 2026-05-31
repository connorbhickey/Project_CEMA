import { describe, expect, it } from 'vitest';

import { IDP_FIXTURES } from './fixtures';
import { IDP_SCORERS, runPipeline } from './scorers';

describe('IDP offline compliance gate', () => {
  it.each(IDP_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runPipeline(fixture.input);
    for (const scorer of IDP_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
