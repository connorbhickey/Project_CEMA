import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  recordings: {
    id: 'r_id_col',
    communicationId: 'r_comm_id_col',
    retentionUntil: 'r_retention_col',
    legalHold: 'r_legal_col',
    deletedAt: 'r_deleted_col',
  },
  communications: {
    id: 'c_id_col',
    organizationId: 'c_org_col',
  },
  auditEvents: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  lt: vi.fn().mockReturnValue({}),
  eq: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  sql: Object.assign(vi.fn().mockReturnValue('now()'), { raw: vi.fn().mockReturnValue('now()') }),
}));

vi.mock('@cema/blob', () => ({ blobDel: vi.fn().mockResolvedValue(undefined) }));

import { blobDel } from '@cema/blob';
import { getDb } from '@cema/db';

import { GET } from './route';

type ExpiredRow = {
  id: string;
  organizationId: string;
  recordingBlobUrl?: string | null;
  transcriptBlobUrl?: string | null;
};

function makeDb(expiredRows: ExpiredRow[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(expiredRows),
          }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  };
}

function makeAuthorizedRequest(): Request {
  return new Request('http://localhost/api/cron/recording-retention', {
    method: 'GET',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
}

function makeUnauthorizedRequest(): Request {
  return new Request('http://localhost/api/cron/recording-retention', {
    method: 'GET',
  });
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
});

describe('GET /api/cron/recording-retention', () => {
  it('returns 200 with purged count when expired recordings exist', async () => {
    const rows: ExpiredRow[] = [
      { id: 'rec-1', organizationId: 'org-1' },
      { id: 'rec-2', organizationId: 'org-1' },
    ];
    vi.mocked(getDb).mockReturnValue(makeDb(rows) as never);
    const res = await GET(makeUnauthorizedRequest());
    const body = (await res.json()) as { purged: number };
    expect(res.status).toBe(200);
    expect(body.purged).toBe(2);
  });

  it('physically deletes the recording + transcript blobs before zeroing the URLs', async () => {
    const rows: ExpiredRow[] = [
      {
        id: 'rec-1',
        organizationId: 'org-1',
        recordingBlobUrl: 'https://blob.example/rec-1.mp3',
        transcriptBlobUrl: 'https://blob.example/rec-1.json',
      },
      { id: 'rec-2', organizationId: 'org-1', recordingBlobUrl: 'https://blob.example/rec-2.mp3' },
    ];
    vi.mocked(getDb).mockReturnValue(makeDb(rows) as never);

    const res = await GET(makeUnauthorizedRequest());
    const body = (await res.json()) as { purged: number; failedDeletes: number };

    expect(body.purged).toBe(2);
    expect(body.failedDeletes).toBe(0);
    // 3 non-empty blob URLs (2 recordings + 1 transcript); empty/null are skipped.
    expect(blobDel).toHaveBeenCalledTimes(3);
    expect(blobDel).toHaveBeenCalledWith('https://blob.example/rec-1.mp3');
    expect(blobDel).toHaveBeenCalledWith('https://blob.example/rec-1.json');
    expect(blobDel).toHaveBeenCalledWith('https://blob.example/rec-2.mp3');
  });

  it('returns 200 with purged:0 when no expired recordings', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([]) as never);
    const res = await GET(makeUnauthorizedRequest());
    const body = (await res.json()) as { purged: number };
    expect(res.status).toBe(200);
    expect(body.purged).toBe(0);
  });

  it('does not call update or insert when no rows expired', async () => {
    const db = makeDb([]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await GET(makeUnauthorizedRequest());
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts one audit_events row per purged recording', async () => {
    const rows: ExpiredRow[] = [
      { id: 'rec-1', organizationId: 'org-1' },
      { id: 'rec-2', organizationId: 'org-2' },
    ];
    const db = makeDb(rows);
    vi.mocked(getDb).mockReturnValue(db as never);
    await GET(makeUnauthorizedRequest());
    expect(db.insert).toHaveBeenCalledOnce();
    // The .values() call gets the array of audit rows.
    const insertChain = db.insert.mock.results[0]!.value as {
      values: ReturnType<typeof vi.fn>;
    };
    const inserted = insertChain.values.mock.calls[0]![0] as Array<{
      action: string;
      organizationId: string;
      entityType: string;
      entityId: string;
    }>;
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({
      action: 'recording.soft_deleted',
      entityType: 'recording',
      entityId: 'rec-1',
      organizationId: 'org-1',
    });
    expect(inserted[1]).toMatchObject({ entityId: 'rec-2', organizationId: 'org-2' });
  });

  it('returns 401 when CRON_SECRET is set and Authorization header is missing', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    vi.mocked(getDb).mockReturnValue(makeDb([]) as never);
    const res = await GET(makeUnauthorizedRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when CRON_SECRET is set and Authorization header is wrong', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    vi.mocked(getDb).mockReturnValue(makeDb([]) as never);
    const req = new Request('http://localhost/api/cron/recording-retention', {
      method: 'GET',
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 when CRON_SECRET is set and Authorization header matches', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    vi.mocked(getDb).mockReturnValue(makeDb([]) as never);
    const res = await GET(makeAuthorizedRequest());
    expect(res.status).toBe(200);
  });

  it('returns 500 with error message when DB query throws', async () => {
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error('db boom')),
            }),
          }),
        }),
      }),
    } as never);
    const res = await GET(makeUnauthorizedRequest());
    const body = (await res.json()) as { purged: number; error: string };
    expect(res.status).toBe(500);
    expect(body.error).toBe('db boom');
  });
});
