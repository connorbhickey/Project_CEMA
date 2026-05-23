import { communications, emailThreads, getDb, slackMessages } from '@cema/db';
import { embedText } from '@cema/embeddings';
import { TopicSchema } from '@cema/queues';
import { indexCommunication } from '@cema/typesense';
import { eq } from 'drizzle-orm';

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as unknown;
  const { orgId, communicationId } = TopicSchema['comms.embed'].parse(body);

  const db = getDb();
  const [comm] = await db
    .select()
    .from(communications)
    .where(eq(communications.id, communicationId))
    .limit(1);

  if (!comm || comm.organizationId !== orgId) {
    return new Response('Not found', { status: 404 });
  }

  const textParts = [comm.aiSummary, comm.sourceThreadId, comm.kind].filter(Boolean);
  if (textParts.length === 0) {
    return new Response('No text to embed', { status: 200 });
  }

  const { embedding } = await embedText({ text: textParts.join(' ') });

  await db
    .update(communications)
    .set({ embedding, embeddingGeneratedAt: new Date() })
    .where(eq(communications.id, communicationId));

  const [[emailThread], [slackMsg]] = await Promise.all([
    db
      .select({ subject: emailThreads.subject, snippet: emailThreads.snippet })
      .from(emailThreads)
      .where(eq(emailThreads.communicationId, communicationId))
      .limit(1),
    db
      .select({ text: slackMessages.text })
      .from(slackMessages)
      .where(eq(slackMessages.communicationId, communicationId))
      .limit(1),
  ]);

  void indexCommunication({
    id: comm.id,
    organization_id: comm.organizationId,
    subject: emailThread?.subject ?? undefined,
    body_preview: emailThread?.snippet ?? slackMsg?.text?.slice(0, 200) ?? undefined,
    direction: comm.direction ?? undefined,
    kind: comm.kind,
    vendor: comm.medium ?? undefined,
    occurred_at: Math.floor((comm.startedAt ?? new Date()).getTime() / 1000),
  });

  return new Response('OK', { status: 200 });
}
