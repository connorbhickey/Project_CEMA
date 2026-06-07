import { EXCEPTION_KINDS, EXCEPTION_ROUTES } from '@cema/agents-exception-triage';
import { describe, expect, it } from 'vitest';

import {
  EXCEPTION_KIND_LABELS,
  EXCEPTION_ROUTE_LABELS,
  exceptionKindLabel,
  exceptionRouteLabel,
} from './exception-labels';

describe('exception-labels', () => {
  it('labels known kinds + routes, falls back to the raw token', () => {
    expect(exceptionKindLabel('purchase_missing_seller')).toBe('Missing Seller');
    expect(exceptionKindLabel('chain_break')).toBe('Chain Break');
    expect(exceptionRouteLabel('processor_review')).toBe('Processor Review');
    expect(exceptionKindLabel('mystery')).toBe('mystery');
  });

  it('kind labels stay in lockstep with the agent EXCEPTION_KINDS (drift guard)', () => {
    expect(Object.keys(EXCEPTION_KIND_LABELS).sort()).toEqual([...EXCEPTION_KINDS].sort());
  });

  it('route labels stay in lockstep with the agent EXCEPTION_ROUTES (drift guard)', () => {
    expect(Object.keys(EXCEPTION_ROUTE_LABELS).sort()).toEqual([...EXCEPTION_ROUTES].sort());
  });
});
