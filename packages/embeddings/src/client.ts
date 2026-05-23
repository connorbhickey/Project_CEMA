import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';

import type { EmbedTextInput, EmbedTextResult } from './types';

const DEFAULT_MODEL = 'text-embedding-3-large';

export async function embedText(input: EmbedTextInput): Promise<EmbedTextResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const res = await embed({
    model: openai.embedding(model),
    value: input.text,
  });
  return {
    embedding: res.embedding,
    dimensions: res.embedding.length,
    model,
    inputTokens: res.usage.tokens,
  };
}
