import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  driveFiles: {
    id: 'f_id',
    organizationId: 'f_org',
    blobUrl: 'f_blob_url',
    blobPathname: 'f_blob_path',
    trashedAt: 'f_trashed',
  },
  auditEvents: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
  lt: vi.fn().mockReturnValue({}),
  ne: vi.fn().mockReturnValue({}),
  sql: Object.assign(vi.fn().mockReturnValue('now()'), { raw: vi.fn().mockReturnValue('') }),
}));

vi.mock('@cema/blob', () => ({ blobDel: vi.fn().mockResolvedValue(undefined) }));

import { blobDel } from '@cema/blob';
import { getDb } from '@cema/db';

import { GET } from './route';

type Row = { id: string; organizationId: string; blobUrl: string | null };

function makeDb(rows: Row[]) {
  const update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  });
  const insert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
      }),
    }),
    update,
    insert,
  };
}

const authReq = () =>
  new Request('http://localhost/api/cron/drive-retention', {
    method: 'GET',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
const noAuthReq = () => new Request('http://localhost/api/cron/drive-retention', { method: 'GET' });

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
});

describe('GET /api/cron/drive-retention', () => {
  it('returns purged:0 when no trashed-and-expired files', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([]) as never);
    const res = await GET(noAuthReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { purged: number };
    expect(body.purged).toBe(0);
    expect(blobDel).not.toHaveBeenCalled();
  });

  it('deletes each blob, zeroes the refs, and audits the purge', async () => {
    const rows: Row[] = [
      { id: 'f-1', organizationId: 'org-1', blobUrl: 'https://blob.example/a.pdf' },
      { id: 'f-2', organizationId: 'org-1', blobUrl: 'https://blob.example/b.pdf' },
    ];
    const db = makeDb(rows);
    vi.mocked(getDb).mockReturnValue(db as never);

    const res = await GET(noAuthReq());
    const body = (await res.json()) as { purged: number; failedDeletes: number };

    expect(body.purged).toBe(2);
    expect(body.failedDeletes).toBe(0);
    expect(blobDel).toHaveBeenCalledTimes(2);
    expect(blobDel).toHaveBeenCalledWith('https://blob.example/a.pdf');
    expect(db.update).toHaveBeenCalledOnce();
    expect(db.insert).toHaveBeenCalledOnce(); // one audit batch
  });

  it('rejects an unauthorized request when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 'shh';
    vi.mocked(getDb).mockReturnValue(makeDb([]) as never);
    const res = await GET(noAuthReq());
    expect(res.status).toBe(401);
  });

  it('allows the authorized cron request', async () => {
    process.env.CRON_SECRET = 'shh';
    vi.mocked(getDb).mockReturnValue(makeDb([]) as never);
    const res = await GET(authReq());
    expect(res.status).toBe(200);
  });
});
