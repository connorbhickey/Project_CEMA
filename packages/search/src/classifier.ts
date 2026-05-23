import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';

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

  const result = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
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

  return result.object;
}
