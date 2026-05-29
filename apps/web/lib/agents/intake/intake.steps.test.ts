import { describe, expect, it } from 'vitest';

import { fetchAndEvaluateStep } from './intake.steps';

/**
 * Unit coverage for the one durable step with no I/O dependency
 * (`fetchAndEvaluateStep` reads the in-memory FixtureLosAdapter). Under the
 * default Vitest config the `'use step'` directive is inert (it is consumed only
 * by withWorkflow's Turbopack plugin at build time), so the step runs as a plain
 * async function here. The DB-backed steps (emit/create) are exercised end-to-end
 * by the Neon-gated @workflow/vitest integration test (Task 5).
 */
describe('intake durable steps', () => {
  describe('fetchAndEvaluateStep', () => {
    it('marks an eligible single-family NY refi as eligible with no reasons', async () => {
      const { application, eligibility } = await fetchAndEvaluateStep('FIX-ELIG-SF');
      expect(application.state).toBe('NY');
      expect(application.cemaType).toBe('refi_cema');
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.reasons).toEqual([]);
    });

    it('marks a co-op as ineligible by property type', async () => {
      const { application, eligibility } = await fetchAndEvaluateStep('FIX-INELIG-COOP');
      expect(application.propertyType).toBe('co_op');
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reasons).toContain('ineligible_property_type');
    });
  });
});
