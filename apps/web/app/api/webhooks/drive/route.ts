import { blobPut } from '@cema/blob';
import { acquireIdempotencyKey, releaseIdempotencyKey } from '@cema/cache';
import { driveFiles, getDb, orgDriveConnections } from '@cema/db';
import {
  downloadDriveFileBytes,
  fetchDriveFile,
  getDriveClient,
  parseDriveNotificationHeaders,
  verifyDriveChannelToken,
} from '@cema/integrations-drive';
import { publish } from '@cema/queues';
import { eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

export async function POST(req: Request): Promise<Response> {
  const headers = parseDriveNotificationHeaders(req.headers);
  if (!headers) {
    return new Response('Bad Request — missing X-Goog headers', { status: 400 });
  }

  const db = getDb();
  const [conn] = await db
    .select({
      id: orgDriveConnections.id,
      organizationId: orgDriveConnections.organizationId,
      oauthRefreshToken: orgDriveConnections.oauthRefreshToken,
      driveChannelToken: orgDriveConnections.driveChannelToken,
    })
    .from(orgDriveConnections)
    .where(eq(orgDriveConnections.driveChannelId, headers.channelId))
    .limit(1);

  if (!conn) {
    return new Response('OK', { status: 200 });
  }

  if (!verifyDriveChannelToken(conn.driveChannelToken ?? '', headers.channelToken)) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (headers.resourceState === 'sync') {
    return new Response('OK', { status: 200 });
  }

  // Replay protection: SETNX on the push's channelId:messageNumber. Google Drive
  // assigns a monotonic X-Goog-Message-Number per channel (unique per push), so a
  // re-delivered notification (same message number) is skipped before the Drive
  // API fetch + blob mirror. Released on failure so a genuine retry re-acquires.
  const idempotencyKey = `webhook:idempo:drive:${headers.channelId}:${headers.messageNumber}`;
  if (!(await acquireIdempotencyKey(idempotencyKey))) {
    return new Response('OK', { status: 200 });
  }

  const fileId = headers.resourceId;

  try {
    const drive = getDriveClient({ refreshToken: conn.oauthRefreshToken });
    const meta = await fetchDriveFile(drive, fileId);

    if (meta.trashed || headers.resourceState === 'trash') {
      await db
        .insert(driveFiles)
        .values({
          organizationId: conn.organizationId,
          driveConnectionId: conn.id,
          driveFileId: fileId,
          fileName: meta.fileName,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
          syncStatus: 'trashed',
          trashedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [driveFiles.driveConnectionId, driveFiles.driveFileId],
          set: { syncStatus: 'trashed', trashedAt: new Date(), updatedAt: new Date() },
        });
      return new Response('OK', { status: 200 });
    }

    const bytes = await downloadDriveFileBytes(drive, fileId);
    const blobPathname = `drive/${conn.organizationId}/${fileId}/${meta.fileName}`;
    const blob = await blobPut(blobPathname, bytes, meta.mimeType);

    await db
      .insert(driveFiles)
      .values({
        organizationId: conn.organizationId,
        driveConnectionId: conn.id,
        driveFileId: fileId,
        driveFolderId: meta.driveFolderId,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        blobPathname: blob.pathname,
        blobUrl: blob.url,
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [driveFiles.driveConnectionId, driveFiles.driveFileId],
        set: {
          fileName: meta.fileName,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
          blobPathname: blob.pathname,
          blobUrl: blob.url,
          syncStatus: 'synced',
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    await publish(
      'files.drive.ingest',
      {
        orgId: conn.organizationId,
        driveFileId: fileId,
        driveConnectionId: conn.id,
        receivedAt: new Date().toISOString(),
      },
      vercelQueueSend,
    );

    return new Response('OK', { status: 200 });
  } catch (err) {
    await releaseIdempotencyKey(idempotencyKey);
    throw err;
  }
}
