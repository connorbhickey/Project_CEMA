import { describe, expect, it } from 'vitest';

import { runChainOfTitle } from './orchestrator';
import type { ChainAuditEvent, ChainDeps, InstrumentRecord, RouteDecision } from './types';

function makeDeps(instruments: readonly InstrumentRecord[]): {
  deps: ChainDeps;
  events: string[];
  audits: ChainAuditEvent[];
  reChased: RouteDecision[];
  attorneyReviews: RouteDecision[];
} {
  const events: string[] = [];
  const audits: ChainAuditEvent[] = [];
  const reChased: RouteDecision[] = [];
  const attorneyReviews: RouteDecision[] = [];
  const deps: ChainDeps = {
    loadInstruments: () => Promise.resolve(instruments),
    routeReChase: (decision) => {
      reChased.push(decision);
      return Promise.resolve();
    },
    openAttorneyReview: (decision) => {
      attorneyReviews.push(decision);
      return Promise.resolve();
    },
    emitAudit: (event) => {
      events.push(event.action);
      audits.push(event);
      return Promise.resolve();
    },
  };
  return { deps, events, audits, reChased, attorneyReviews };
}

const REC = (crfn: string) => ({ reelPage: null, crfn });
const baseInst = {
  assignor: null,
  assignee: null,
  executedAt: null,
  recordedAt: null,
  amount: null,
  county: null,
  references: null,
};

describe('runChainOfTitle', () => {
  it('emits only chain.analyzed and calls no seam for a clean chain', async () => {
    const instruments: InstrumentRecord[] = [
      { ...baseInst, documentId: 'm1', instrumentKind: 'mortgage', recordingRef: REC('c-m1') },
      {
        ...baseInst,
        documentId: 'a1',
        instrumentKind: 'aom',
        assignor: 'A',
        assignee: 'B',
        recordedAt: '2026-01-01',
        recordingRef: REC('c-a1'),
      },
    ];
    const { deps, events, reChased, attorneyReviews } = makeDeps(instruments);

    const result = await runChainOfTitle('deal-1', deps);

    expect(result.status).toBe('clean');
    expect(events).toEqual(['chain.analyzed']);
    expect(reChased).toHaveLength(0);
    expect(attorneyReviews).toHaveLength(0);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.kind).toBe('advisory_pass');
  });

  it('emits chain.analyzed then chain.routed and opens attorney_review for a fork', async () => {
    const instruments: InstrumentRecord[] = [
      { ...baseInst, documentId: 'm1', instrumentKind: 'mortgage', recordingRef: REC('c-m1') },
      {
        ...baseInst,
        documentId: 'a1',
        instrumentKind: 'aom',
        assignor: 'A',
        assignee: 'B',
        recordedAt: '2026-01-01',
        recordingRef: REC('c-a1'),
      },
      {
        ...baseInst,
        documentId: 'a2',
        instrumentKind: 'aom',
        assignor: 'A',
        assignee: 'C',
        recordedAt: '2026-02-01',
        recordingRef: REC('c-a2'),
      },
    ];
    const { deps, events, audits, reChased, attorneyReviews } = makeDeps(instruments);

    const result = await runChainOfTitle('deal-1', deps);

    expect(result.status).toBe('ambiguous');
    expect(events).toEqual(['chain.analyzed', 'chain.routed']);
    expect(attorneyReviews.every((r) => r.kind === 'attorney_review')).toBe(true);
    expect(attorneyReviews).toHaveLength(2);
    expect(reChased).toHaveLength(0);
    expect(audits[0]).toEqual(
      expect.objectContaining({
        action: 'chain.analyzed',
        status: 'ambiguous',
        attorneyReviewCount: 2,
      }),
    );
  });

  it('routes a sequential gap to re_chase (broken)', async () => {
    const instruments: InstrumentRecord[] = [
      { ...baseInst, documentId: 'm1', instrumentKind: 'mortgage', recordingRef: REC('c-m1') },
      {
        ...baseInst,
        documentId: 'a1',
        instrumentKind: 'aom',
        assignor: 'A',
        assignee: 'B',
        recordedAt: '2026-01-01',
        recordingRef: REC('c-a1'),
      },
      {
        ...baseInst,
        documentId: 'a2',
        instrumentKind: 'aom',
        assignor: 'C',
        assignee: 'D',
        recordedAt: '2026-02-01',
        recordingRef: REC('c-a2'),
      },
    ];
    const { deps, events, audits, reChased, attorneyReviews } = makeDeps(instruments);

    const result = await runChainOfTitle('deal-1', deps);

    expect(result.status).toBe('broken');
    expect(events).toEqual(['chain.analyzed', 'chain.routed']);
    expect(reChased).toHaveLength(1);
    expect(reChased[0]?.kind).toBe('re_chase');
    expect(attorneyReviews).toHaveLength(0);
    expect(audits[0]).toEqual(expect.objectContaining({ reChaseCount: 1, attorneyReviewCount: 0 }));
  });
});
