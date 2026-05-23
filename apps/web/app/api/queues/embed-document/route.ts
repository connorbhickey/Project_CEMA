import { deals, documents, getDb } from '@cema/db';
import { embedText } from '@cema/embeddings';
import { TopicSchema } from '@cema/queues';
import { eq } from 'drizzle-orm';

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as unknown;
  const { orgId, documentId } = TopicSchema['docs.embed'].parse(body);

  const db = getDb();
  const [row] = await db
    .select({ doc: documents, dealOrgId: deals.organizationId })
    .from(documents)
    .innerJoin(deals, eq(documents.dealId, deals.id))
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!row || row.dealOrgId !== orgId) {
    return new Response('Not found', { status: 404 });
  }

  const { doc } = row;
  const extractedText =
    doc.extractedData && Object.keys(doc.extractedData).length > 0
      ? JSON.stringify(doc.extractedData)
      : '';
  const textParts = [doc.kind, extractedText].filter(Boolean);

  const { embedding } = await embedText({ text: textParts.join(' ') });

  await db
    .update(documents)
    .set({ embedding, embeddingGeneratedAt: new Date() })
    .where(eq(documents.id, documentId));

  return new Response('OK', { status: 200 });
}
