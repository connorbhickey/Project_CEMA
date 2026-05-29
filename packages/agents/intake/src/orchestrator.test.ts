import { describe, expect, it } from 'vitest';

import { FixtureLosAdapter } from './fixture-los-adapter';
import { runIntake } from './orchestrator';
import type { IntakeAuditEvent, IntakeDealInput, IntakeDeps, RecordingTaxRateTable } from './types';

/** A deterministic, NON-placeholder table so savings assertions are stable. */
const synthetic: RecordingTaxRateTable = {
  isPlaceholder: false,
  ratesByCounty: { kings: 0.02 },
  defaultRate: 0.01,
  estimatedFees: 1_000,
};

interface Harness {
  deps: IntakeDeps;
  /** Every event passed to deps.emitAudit, in call order. */
  auditEvents: IntakeAuditEvent[];
  /** Every input passed to deps.createDeal, in call order. */
  createDealInputs: IntakeDealInput[];
  /** Names of collaborators in the exact order they were invoked. */
  callOrder: string[];
}

interface HarnessOverrides {
  /** Replace the deal-creation fake (e.g. to force a rejection). */
  createDeal?: IntakeDeps['createDeal'];
  /** Leave deps.rates unset so the orchestrator falls back to PLACEHOLDER_RATES. */
  omitRates?: boolean;
}

/** Builds an IntakeDeps of recording fakes plus the arrays they record into. */
function harness(overrides: HarnessOverrides = {}): Harness {
  const auditEvents: IntakeAuditEvent[] = [];
  const createDealInputs: IntakeDealInput[] = [];
  const callOrder: string[] = [];

  // Wrap any supplied override so the call is still recorded (order + input)
  // before its behaviour — e.g. a rejection — takes effect.
  const createDealBehaviour = overrides.createDeal;
  const deps: IntakeDeps = {
    adapter: new FixtureLosAdapter(),
    emitAudit: (event) => {
      callOrder.push('emitAudit');
      auditEvents.push(event);
      return Promise.resolve();
    },
    createDeal: (input) => {
      callOrder.push('createDeal');
      createDealInputs.push(input);
      return createDealBehaviour
        ? createDealBehaviour(input)
        : Promise.resolve({ dealId: `DEAL-${input.application.externalId}` });
    },
  };

  if (!overrides.omitRates) {
    deps.rates = synthetic;
  }

  return { deps, auditEvents, createDealInputs, callOrder };
}

describe('runIntake', () => {
  describe('eligible application', () => {
    it('returns an eligible result with savings and a dealId', async () => {
      const h = harness();
      const result = await runIntake('FIX-ELIG-SF', h.deps);

      expect(result.externalId).toBe('FIX-ELIG-SF');
      expect(result.eligibility.eligible).toBe(true);
      expect(result.eligibility.reasons).toEqual([]);
      expect(result.savings).not.toBeNull();
      expect(result.dealId).toBe('DEAL-FIX-ELIG-SF');
    });

    it('creates exactly one deal, threading the same savings it returns', async () => {
      const h = harness();
      const result = await runIntake('FIX-ELIG-SF', h.deps);

      expect(h.createDealInputs).toHaveLength(1);
      expect(h.createDealInputs[0]?.application.externalId).toBe('FIX-ELIG-SF');
      // The savings handed to createDeal is the same object surfaced on the result.
      expect(h.createDealInputs[0]?.savings).toBe(result.savings);
    });

    it('emits intake.evaluated BEFORE creating the deal', async () => {
      const h = harness();
      await runIntake('FIX-ELIG-SF', h.deps);

      expect(h.callOrder).toEqual(['emitAudit', 'createDeal']);
      expect(h.auditEvents).toHaveLength(1);
      expect(h.auditEvents[0]?.action).toBe('intake.evaluated');
      expect(h.auditEvents[0]?.externalId).toBe('FIX-ELIG-SF');
      expect(h.auditEvents[0]?.eligible).toBe(true);
      expect(h.auditEvents[0]?.reasons).toEqual([]);
    });

    it('computes savings from the injected rate table', async () => {
      const h = harness();
      const result = await runIntake('FIX-ELIG-SF', h.deps);

      // Kings @ 0.02 on the full 400k UPB, fees 1k → see synthetic table.
      expect(result.savings?.assignedUpb).toBe(400_000);
      expect(result.savings?.appliedRate).toBe(0.02);
      expect(result.savings?.isPlaceholderRate).toBe(false);
    });

    it('falls back to PLACEHOLDER_RATES when no table is injected', async () => {
      const h = harness({ omitRates: true });
      const result = await runIntake('FIX-ELIG-SF', h.deps);

      expect(result.savings?.isPlaceholderRate).toBe(true);
    });
  });

  describe('ineligible application', () => {
    it('records the decision but creates no deal', async () => {
      const h = harness();
      const result = await runIntake('FIX-INELIG-COOP', h.deps);

      expect(result.eligibility.eligible).toBe(false);
      expect(result.eligibility.reasons).toContain('ineligible_property_type');
      expect(result.savings).toBeNull();
      expect(result.dealId).toBeNull();
      expect(h.createDealInputs).toHaveLength(0);
      expect(h.callOrder).toEqual(['emitAudit']);
    });

    it('still emits intake.evaluated carrying the failure reasons', async () => {
      const h = harness();
      await runIntake('FIX-INELIG-COOP', h.deps);

      expect(h.auditEvents).toHaveLength(1);
      expect(h.auditEvents[0]?.eligible).toBe(false);
      expect(h.auditEvents[0]?.reasons).toContain('ineligible_property_type');
    });
  });

  describe('failure propagation', () => {
    it('rejects without auditing when the application is not found', async () => {
      const h = harness();

      await expect(runIntake('NOPE', h.deps)).rejects.toThrow(/NOPE/);
      expect(h.auditEvents).toHaveLength(0);
      expect(h.createDealInputs).toHaveLength(0);
      expect(h.callOrder).toEqual([]);
    });

    it('propagates a createDeal failure but keeps the audit row already written', async () => {
      const h = harness({ createDeal: () => Promise.reject(new Error('db down')) });

      await expect(runIntake('FIX-ELIG-SF', h.deps)).rejects.toThrow(/db down/);
      // The decision was durably recorded before deal creation was attempted.
      expect(h.auditEvents).toHaveLength(1);
      expect(h.auditEvents[0]?.action).toBe('intake.evaluated');
      expect(h.auditEvents[0]?.eligible).toBe(true);
      expect(h.callOrder).toEqual(['emitAudit', 'createDeal']);
    });
  });
});
