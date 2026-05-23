import { google, type drive_v3 } from 'googleapis';

import type { NormalizedDriveFile, StartDriveWatchInput, StartDriveWatchResult } from './types';

export interface GetDriveClientInput {
  refreshToken: string;
  clientId?: string;
  clientSecret?: string;
}

export function getDriveClient(input: GetDriveClientInput): drive_v3.Drive {
  const oauth2 = new google.auth.OAuth2(
    input.clientId ?? process.env.GOOGLE_CLIENT_ID,
    input.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: input.refreshToken });
  return google.drive({ version: 'v3', auth: oauth2 });
}

export async function fetchDriveFile(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<NormalizedDriveFile> {
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, parents, trashed, modifiedTime',
  });
  const f = res.data as {
    id?: string | null;
    name?: string | null;
    mimeType?: string | null;
    size?: string | null;
    parents?: string[] | null;
    trashed?: boolean | null;
    modifiedTime?: string | null;
  };
  return {
    driveFileId: f.id ?? fileId,
    driveFolderId: f.parents?.[0] ?? null,
    fileName: f.name ?? '',
    mimeType: f.mimeType ?? 'application/octet-stream',
    sizeBytes: f.size != null ? Number(f.size) : null,
    trashed: Boolean(f.trashed),
    modifiedTime: f.modifiedTime ? new Date(f.modifiedTime) : null,
  };
}

export async function downloadDriveFileBytes(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<Buffer> {
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  const data = res.data as ArrayBuffer | Buffer;
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

export async function startDriveWatch(
  drive: drive_v3.Drive,
  input: StartDriveWatchInput,
): Promise<StartDriveWatchResult> {
  const res = await drive.files.watch({
    fileId: input.fileId,
    requestBody: {
      id: input.channelId,
      type: 'web_hook',
      address: input.webhookUrl,
      token: input.channelToken,
      expiration: String(Date.now() + input.ttlSeconds * 1000),
    },
  });
  const d = res.data as {
    id?: string | null;
    expiration?: string | null;
    resourceId?: string | null;
  };
  return {
    channelId: d.id ?? input.channelId,
    expiration: d.expiration ? new Date(Number(d.expiration)) : new Date(),
    resourceId: d.resourceId ?? '',
  };
}
