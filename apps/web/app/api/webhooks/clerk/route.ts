import { getDb } from '@cema/db';
import type { WebhookEvent } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { Webhook } from 'svix';

import { handleClerkWebhook } from '@/lib/clerk-sync';

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return new Response('Missing CLERK_WEBHOOK_SECRET', { status: 500 });
  }
  const hdrs = await headers();
  const svixId = hdrs.get('svix-id');
  const svixTimestamp = hdrs.get('svix-timestamp');
  const svixSignature = hdrs.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing svix headers', { status: 400 });
  }
  const payload = await req.text();
  const webhook = new Webhook(secret);
  let event: WebhookEvent;
  try {
    event = webhook.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as WebhookEvent;
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
  await handleClerkWebhook(getDb(), event);
  return new Response('OK', { status: 200 });
}
