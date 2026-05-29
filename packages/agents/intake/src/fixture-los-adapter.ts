import { DEFAULT_FIXTURES } from './fixtures';
import type { LosAdapter, NormalizedApplication } from './types';

/**
 * In-memory LosAdapter (spec §13.6) backed by deterministic fixtures, so the
 * agent core is testable today with zero vendor credentials. The Encompass
 * adapter is the first real implementation (later slice).
 */
export class FixtureLosAdapter implements LosAdapter {
  private readonly byId: Map<string, NormalizedApplication>;

  constructor(fixtures: readonly NormalizedApplication[] = DEFAULT_FIXTURES) {
    this.byId = new Map(fixtures.map((f) => [f.externalId, f]));
  }

  // Not `async`: the fixture lookup is synchronous, so we return a settled
  // Promise directly. A synchronous `throw` would surface at the call site
  // instead of as a rejection — callers (and tests) expect a rejected Promise.
  getApplication(externalId: string): Promise<NormalizedApplication> {
    const app = this.byId.get(externalId);
    return app
      ? Promise.resolve(app)
      : Promise.reject(new Error(`FixtureLosAdapter: no fixture for externalId "${externalId}"`));
  }
}
