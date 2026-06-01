import { describe, expect, it } from 'vitest';

import { triageExceptions } from './triage';
import { EXCEPTION_KINDS, EXCEPTION_ROUTES, EXCEPTION_SEVERITIES } from './types';
import type { DealSignals } from './types';

const NONE: DealSignals = { dealStatus: 'title_work', chainBreakCount: 0, dispatchFailed: false };

describe('triageExceptions', () => {
  it('returns no exceptions for a clean deal', () => {
    expect(triageExceptions(NONE)).toEqual([]);
  });

  it('flags chain_break (high → attorney_review) when chain breaks are open', () => {
    const [ex, ...rest] = triageExceptions({ ...NONE, chainBreakCount: 2 });
    expect(rest).toHaveLength(0);
    expect(ex).toMatchObject({ kind: 'chain_break', severity: 'high', route: 'attorney_review' });
  });

  it('flags agent_dispatch_failed (medium → reprocess)', () => {
    const [ex] = triageExceptions({ ...NONE, dispatchFailed: true });
    expect(ex).toMatchObject({
      kind: 'agent_dispatch_failed',
      severity: 'medium',
      route: 'reprocess',
    });
  });

  it('flags deal_flagged_exception (high → processor_review) when status is exception', () => {
    const [ex] = triageExceptions({ ...NONE, dealStatus: 'exception' });
    expect(ex).toMatchObject({
      kind: 'deal_flagged_exception',
      severity: 'high',
      route: 'processor_review',
    });
  });

  it('emits every applicable exception together', () => {
    const ex = triageExceptions({
      dealStatus: 'exception',
      chainBreakCount: 1,
      dispatchFailed: true,
    });
    expect(ex.map((e) => e.kind).sort()).toEqual([
      'agent_dispatch_failed',
      'chain_break',
      'deal_flagged_exception',
    ]);
  });

  it('reasons are static PII-free strings (no interpolated counts/ids/names)', () => {
    const ex = triageExceptions({
      dealStatus: 'exception',
      chainBreakCount: 7,
      dispatchFailed: true,
    });
    for (const e of ex) {
      expect(e.reason.length).toBeGreaterThan(0);
      expect(e.reason).not.toMatch(/\d/); // no count/id leaks into the reason
    }
  });

  it('exposes consistent enums', () => {
    expect([...EXCEPTION_KINDS].sort()).toEqual([
      'agent_dispatch_failed',
      'chain_break',
      'deal_flagged_exception',
    ]);
    expect(EXCEPTION_SEVERITIES).toContain('blocking');
    expect(EXCEPTION_ROUTES).toContain('attorney_review');
  });
});
