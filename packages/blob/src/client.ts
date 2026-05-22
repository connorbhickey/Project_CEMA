import { del, put, type PutBlobResult } from '@vercel/blob';

export type { PutBlobResult };

export async function blobPut(
  pathname: string,
  body: Parameters<typeof put>[1],
  contentType: string,
): Promise<PutBlobResult> {
  return put(pathname, body, { access: 'public', addRandomSuffix: false, contentType });
}

export async function blobDel(url: string): Promise<void> {
  await del(url, {});
}
