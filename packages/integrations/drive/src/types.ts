export interface NormalizedDriveFile {
  driveFileId: string;
  driveFolderId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  trashed: boolean;
  modifiedTime: Date | null;
}

export interface DriveNotificationHeaders {
  channelId: string;
  channelToken: string;
  resourceState: 'sync' | 'add' | 'remove' | 'update' | 'trash' | 'untrash' | 'change';
  resourceId: string;
  messageNumber: string;
}

export interface StartDriveWatchInput {
  fileId: string;
  channelId: string;
  channelToken: string;
  webhookUrl: string;
  ttlSeconds: number;
}

export interface StartDriveWatchResult {
  channelId: string;
  expiration: Date;
  resourceId: string;
}
