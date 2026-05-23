import { communications, getDb } from '@cema/db';
import { embedText } from '@cema/embeddings';
import { TopicSchema } from '@cema/queues';
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

  return new Response('OK', { status: 200 });
}
