import { communications, deals, getDb, orgSlackConnections, slackMessages } from '@cema/db';
import {
  fetchSlackUserDisplayName,
  getSlackClient,
  parseSlackEventPayload,
  parseSlackSlashCommand,
  postEphemeralReply,
  verifySlackSignature,
} from '@cema/integrations-slack';
import { publish } from '@cema/queues';
import { and, eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

export async function POST(req: Request): Promise<Response> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return new Response('SLACK_SIGNING_SECRET not configured', { status: 500 });
  }

  const sig = req.headers.get('x-slack-signature') ?? '';
  const ts = req.headers.get('x-slack-request-timestamp') ?? '';
  const rawBody = await req.text();

  if (!verifySlackSignature(signingSecret, sig, ts, rawBody)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return handleSlashCommand(rawBody);
  }

  const payload = parseSlackEventPayload(rawBody);

  if (payload.type === 'url_verification') {
    return Response.json({ challenge: payload.challenge });
  }

  if (payload.type !== 'event_callback') {
    return new Response('OK', { status: 200 });
  }

  const db = getDb();
  const [conn] = await db
    .select({
      organizationId: orgSlackConnections.organizationId,
      slackBotToken: orgSlackConnections.slackBotToken,
    })
    .from(orgSlackConnections)
    .where(eq(orgSlackConnections.slackTeamId, payload.team_id))
    .limit(1);

  if (!conn) {
    return new Response('OK', { status: 200 });
  }

  const evt = payload.event;
  if (evt.type !== 'message' && evt.type !== 'app_mention') {
    return new Response('OK', { status: 200 });
  }

  if (evt.type === 'message' && 'subtype' in evt && evt.subtype) {
    return new Response('OK', { status: 200 });
  }

  const orgId = conn.organizationId;
  const client = getSlackClient(conn.slackBotToken);
  const displayName = evt.user ? await fetchSlackUserDisplayName(client, evt.user) : null;

  const vendorEventId = `${payload.team_id}:${evt.channel}:${evt.ts}`;
  const messageType =
    evt.type === 'app_mention' ? 'app_mention' : evt.thread_ts ? 'thread_reply' : 'message';

  const [comm] = await db
    .insert(communications)
    .values({
      organizationId: orgId,
      kind: 'slack',
      direction: 'inbound',
      medium: 'slack',
      vendorEventId,
      sourceThreadId: evt.thread_ts ?? evt.ts,
      startedAt: new Date(Math.floor(Number(evt.ts) * 1000)),
      status: 'ready',
    })
    .onConflictDoUpdate({
      target: communications.vendorEventId,
      set: { status: 'ready', updatedAt: new Date() },
    })
    .returning();

  if (!comm) {
    return new Response('OK', { status: 200 });
  }

  await db
    .insert(slackMessages)
    .values({
      communicationId: comm.id,
      slackTeamId: payload.team_id,
      slackChannelId: evt.channel,
      slackChannelName: null,
      slackMessageTs: evt.ts,
      slackThreadTs: evt.thread_ts ?? null,
      authorSlackUserId: evt.user ?? null,
      authorDisplayName: displayName,
      text: evt.text ?? null,
      rawPayload: evt,
      hasAttachments: 'files' in evt && Array.isArray(evt.files) && evt.files.length > 0,
      messageType,
    })
    .onConflictDoUpdate({
      target: [
        slackMessages.slackTeamId,
        slackMessages.slackChannelId,
        slackMessages.slackMessageTs,
      ],
      set: { text: evt.text ?? null, updatedAt: new Date() },
    });

  await publish(
    'comms.slack.ingest',
    {
      orgId,
      communicationId: comm.id,
      slackTeamId: payload.team_id,
      slackChannelId: evt.channel,
      slackMessageTs: evt.ts,
      receivedAt: new Date().toISOString(),
    },
    vercelQueueSend,
  );

  return new Response('OK', { status: 200 });
}

async function handleSlashCommand(rawBody: string): Promise<Response> {
  const cmd = parseSlackSlashCommand(rawBody);
  const [verb, dealRef] = cmd.text.split(/\s+/);
  if (verb !== 'status' || !dealRef) {
    return Response.json({
      response_type: 'ephemeral',
      text: 'Usage: `/cema status DEAL-1234`',
    });
  }

  const db = getDb();
  const [conn] = await db
    .select({
      organizationId: orgSlackConnections.organizationId,
      slackBotToken: orgSlackConnections.slackBotToken,
    })
    .from(orgSlackConnections)
    .where(eq(orgSlackConnections.slackTeamId, cmd.team_id))
    .limit(1);

  if (!conn) {
    return Response.json({ response_type: 'ephemeral', text: 'Workspace not linked to CEMA.' });
  }

  const [deal] = await db
    .select({ id: deals.id, status: deals.status })
    .from(deals)
    .where(and(eq(deals.organizationId, conn.organizationId), eq(deals.id, dealRef)))
    .limit(1);

  const replyText = deal
    ? `Deal ${dealRef}: status \`${deal.status}\``
    : `Deal ${dealRef} not found.`;

  const slackClient = getSlackClient(conn.slackBotToken);
  await postEphemeralReply(slackClient, {
    channel: cmd.channel_id,
    user: cmd.user_id,
    text: replyText,
  });

  return new Response('', { status: 200 });
}
