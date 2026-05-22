import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-123'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  communications: {},
  recordings: {},
}));

vi.mock('@cema/blob', () => ({
  signedDownloadUrl: vi
    .fn()
    .mockResolvedValue('https://signed.blob.example.com/audio.wav?token=abc'),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({
  withRls: vi.fn(),
}));

import { signedDownloadUrl } from '@cema/blob';
import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { getCommunication } from './get-communication';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-123' };
const DEAL_ID = 'deal-uuid-1';
const COMM_ID = 'comm-uuid-1';

const COMM = {
  id: COMM_ID,
  dealId: DEAL_ID,
  organizationId: ORG.id,
  kind: 'call',
  direction: 'outbound',
  status: 'ready',
  fromE164: '+12125559999',
  toE164: '+12125551234',
  startedAt: new Date('2026-05-22T01:00:00Z'),
  durationSeconds: 120,
  createdAt: new Date('2026-05-22T01:00:00Z'),
};

const RECORDING = {
  id: 'rec-uuid-1',
  communicationId: COMM_ID,
  recordingBlobUrl: 'https://blob.vercel-storage.com/recordings/rec-uuid-1/audio.wav',
  transcriptBlobUrl: null,
};

function makeMockTx(comm = COMM, recording: unknown = RECORDING) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValueOnce([comm]).mockResolvedValueOnce([recording]),
        }),
      }),
    }),
  };
}

describe('getCommunication', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: {
          findFirst: vi.fn().mockResolvedValue(ORG),
        },
      },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when organization is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: { findFirst: vi.fn().mockResolvedValue(null) },
      },
    } as unknown as ReturnType<typeof getDb>);

    const result = await getCommunication(DEAL_ID, COMM_ID);
    expect(result).toBeNull();
  });

  it('returns null when communication is not found', async () => {
    const mockTx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(mockTx as never));

    const result = await getCommunication(DEAL_ID, COMM_ID);
    expect(result).toBeNull();
  });

  it('returns communication and recording on happy path', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx() as never));

    const result = await getCommunication(DEAL_ID, COMM_ID);

    expect(result).not.toBeNull();
    expect(result?.communication.id).toBe(COMM_ID);
    expect(result?.recording?.id).toBe('rec-uuid-1');
  });

  it('generates a signed audio URL when recording has a blob URL', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx() as never));

    const result = await getCommunication(DEAL_ID, COMM_ID);

    expect(signedDownloadUrl).toHaveBeenCalledWith(RECORDING.recordingBlobUrl, 3600);
    expect(result?.signedAudioUrl).toBe('https://signed.blob.example.com/audio.wav?token=abc');
  });

  it('returns null signedAudioUrl when recording has no blob URL', async () => {
    const noAudioRecording = { ...RECORDING, recordingBlobUrl: null };
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeMockTx(COMM, noAudioRecording) as never),
    );

    const result = await getCommunication(DEAL_ID, COMM_ID);

    expect(result?.signedAudioUrl).toBeNull();
  });
});
