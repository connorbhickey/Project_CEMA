import { createAnthropic } from '@ai-sdk/anthropic';
import { withChildSpan } from '@cema/observability';
import { trace } from '@opentelemetry/api';
import { generateObject } from 'ai';
import { z } from 'zod';

/** Vercel AI Gateway, Anthropic-compatible endpoint (ADR 0012) — keeps us on AI SDK v4. */
const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

/** Confirm against the live Gateway catalog once provisioned (ADR 0012 carry-over). */
const GATEWAY_MODEL = 'anthropic/claude-sonnet-4.6';

const tracer = trace.getTracer('@cema/search');

export type QueryIntent = 'search' | 'action' | 'analytics';

export interface QueryClassification {
  intent: QueryIntent;
  confidence: number;
  entities: Array<{ value: string; type: 'org' | 'person' | 'date' | 'deal' | 'other' }>;
}

const ClassificationSchema = z.object({
  intent: z.enum(['search', 'action', 'analytics']),
  confidence: z.number().min(0).max(1),
  entities: z.array(
    z.object({
      value: z.string(),
      type: z.enum(['org', 'person', 'date', 'deal', 'other']),
    }),
  ),
});

export async function classifyQueryIntent(query: string): Promise<QueryClassification> {
  if (!query.trim()) {
    return { intent: 'search', confidence: 1, entities: [] };
  }

  return withChildSpan(tracer, 'search.classify_query', async (span) => {
    span.setAttribute('gen_ai.request.model', GATEWAY_MODEL);

    const gateway = createAnthropic({
      baseURL: GATEWAY_BASE_URL,
      apiKey: process.env.AI_GATEWAY_API_KEY,
    });

    const result = await generateObject({
      model: gateway(GATEWAY_MODEL),
      schema: ClassificationSchema,
      prompt: `You are classifying a query against a CEMA mortgage processor workspace.

Classify into one of:
  - "search": find existing communications, documents, contacts, or deals
  - "action": perform an operation (call, send email, schedule)
  - "analytics": aggregate data (counts, averages, trends)

Extract named entities.

Query: ${query}

Respond with a JSON object matching the schema. Most queries are 'search'.`,
    });

    // Only the non-PII classification lands on the span — never the query text
    // or the extracted entity values (hard rule #3 / spans are logs).
    span.setAttribute('search.intent', result.object.intent);
    span.setAttribute('search.confidence', result.object.confidence);

    return result.object;
  });
}
