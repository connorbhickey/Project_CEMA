import { describe, expect, it } from 'vitest';

import { summarizePipeline } from './pipeline-summary';

describe('summarizePipeline', () => {
  it('orders active stages canonically and zero-fills missing statuses', () => {
    const s = summarizePipeline([
      { status: 'recording', count: 1 },
      { status: 'intake', count: 2 },
    ]);
    expect(s.stages.map((x) => x.status)).toEqual([
      'intake',
      'eligibility',
      'authorization',
      'collateral_chase',
      'title_work',
      'doc_prep',
      'attorney_review',
      'closing',
      'recording',
    ]);
    expect(s.stages.find((x) => x.status === 'intake')?.count).toBe(2);
    expect(s.stages.find((x) => x.status === 'eligibility')?.count).toBe(0);
  });

  it('separates off-ramps and computes activeTotal vs total', () => {
    const s = summarizePipeline([
      { status: 'intake', count: 2 },
      { status: 'closing', count: 1 },
      { status: 'completed', count: 5 },
      { status: 'cancelled', count: 3 },
      { status: 'exception', count: 1 },
    ]);
    expect(s.activeTotal).toBe(3);
    expect(s.total).toBe(12);
    expect(s.offRamps.map((x) => x.status)).toEqual(['completed', 'exception', 'cancelled']);
    expect(s.offRamps.find((x) => x.status === 'completed')?.count).toBe(5);
  });

  it('counts unknown statuses in total but not in the funnel', () => {
    const s = summarizePipeline([
      { status: 'intake', count: 1 },
      { status: 'mystery', count: 9 },
    ]);
    expect(s.activeTotal).toBe(1);
    expect(s.total).toBe(10);
    expect(s.stages.some((x) => x.status === 'mystery')).toBe(false);
    expect(s.offRamps.some((x) => x.status === 'mystery')).toBe(false);
  });

  it('handles empty input as an all-zero funnel', () => {
    const s = summarizePipeline([]);
    expect(s.total).toBe(0);
    expect(s.activeTotal).toBe(0);
    expect(s.stages).toHaveLength(9);
    expect(s.offRamps).toHaveLength(3);
    expect(s.stages.every((x) => x.count === 0)).toBe(true);
  });
});
