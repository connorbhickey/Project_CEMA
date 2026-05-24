import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  recordings: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  lt: vi.fn().mockReturnValue({}),
  eq: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  // sql is a tagged template literal in production; mock it as a callable that returns a string
  sql: Object.assign(vi.fn().mockReturnValue('now()'), { raw: vi.fn().mockReturnValue('now()') }),
}));

import { getDb } from '@cema/db';

import { GET } from './route';

function makeDb(expiredRows: { id: string }[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(expiredRows),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
}

describe('GET /api/cron/recording-retention', () => {
  it('returns 200 with purged count when expired recordings exist', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([{ id: 'rec-1' }, { id: 'rec-2' }]) as never);
    const res = await GET();
    const body = (await res.json()) as { purged: number };
    expect(res.status).toBe(200);
    expect(body.purged).toBe(2);
  });

  it('returns 200 with purged:0 when no expired recordings', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([]) as never);
    const res = await GET();
    const body = (await res.json()) as { purged: number };
    expect(res.status).toBe(200);
    expect(body.purged).toBe(0);
  });

  it('does not call update when no rows expired', async () => {
    const db = makeDb([]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await GET();
    expect(db.update).not.toHaveBeenCalled();
  });
});
