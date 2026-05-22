import type { DriveNotificationHeaders } from './types';

export function parseDriveNotificationHeaders(headers: Headers): DriveNotificationHeaders | null {
  const channelId = headers.get('x-goog-channel-id');
  const channelToken = headers.get('x-goog-channel-token');
  const resourceState = headers.get('x-goog-resource-state');
  const resourceId = headers.get('x-goog-resource-id');
  const messageNumber = headers.get('x-goog-message-number');
  if (!channelId || !resourceState || !resourceId) return null;
  return {
    channelId,
    channelToken: channelToken ?? '',
    resourceState: resourceState as DriveNotificationHeaders['resourceState'],
    resourceId,
    messageNumber: messageNumber ?? '',
  };
}

export function verifyDriveChannelToken(expectedToken: string, presentedToken: string): boolean {
  if (!expectedToken) return false;
  return expectedToken === presentedToken;
}
