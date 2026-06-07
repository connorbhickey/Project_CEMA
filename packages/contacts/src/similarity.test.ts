import { describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS, isValidEmbedding } from './similarity';

const finiteVec = (len: number): number[] => new Array<number>(len).fill(0.1);

describe('isValidEmbedding', () => {
  it('accepts a 3072-length array of finite numbers', () => {
    expect(isValidEmbedding(finiteVec(EMBEDDING_DIMENSIONS))).toBe(true);
  });

  it('rejects a wrong-dimension vector (would hard-fail the pgvector <=> / insert)', () => {
    expect(isValidEmbedding(finiteVec(1536))).toBe(false); // e.g. ada-002 / text-embedding-3-small
    expect(isValidEmbedding(finiteVec(3071))).toBe(false);
    expect(isValidEmbedding([])).toBe(false);
  });

  it('rejects non-finite elements (NaN / Infinity are rejected by pgvector)', () => {
    const withNaN = finiteVec(EMBEDDING_DIMENSIONS);
    withNaN[5] = Number.NaN;
    expect(isValidEmbedding(withNaN)).toBe(false);

    const withInf = finiteVec(EMBEDDING_DIMENSIONS);
    withInf[10] = Number.POSITIVE_INFINITY;
    expect(isValidEmbedding(withInf)).toBe(false);
  });

  it('rejects null / undefined', () => {
    expect(isValidEmbedding(null)).toBe(false);
    expect(isValidEmbedding(undefined)).toBe(false);
  });
});
