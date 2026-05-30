import { createAnthropic } from '@ai-sdk/anthropic';
import { withChildSpan } from '@cema/observability';
import { trace } from '@opentelemetry/api';
import { generateText } from 'ai';

import type { ServicerResponse, ServicerResponseKind } from './types';

const tracer = trace.getTracer('@cema/agents-servicer-outreach');
const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
const CLASSIFY_MODEL = 'anthropic/claude-opus-4.7';

export function isClassifierConfigured(): boolean {
  return !!process.env.AI_GATEWAY_API_KEY;
}

const VALID: readonly ServicerResponseKind[] = [
  'delivered',
  'rejected',
  'needs_info',
  'other',
] as const;

/**
 * DORMANT (no Phase 1 caller). Classifies an inbound servicer reply into a
 * ServicerResponse. Unconfigured -> {kind:'other'} (a no-op that keeps the
 * cadence running). When wired to inbound ingestion later, the 'delivered' /
 * 'rejected' / 'needs_info' kinds stop or branch the cadence.
 */
export async function classifyServicerResponse(input: {
  responseText: string;
}): Promise<ServicerResponse> {
  if (!isClassifierConfigured()) return { kind: 'other' };

  return withChildSpan(tracer, 'outreach.classify_response', async (span) => {
    span.setAttribute('gen_ai.request.model', CLASSIFY_MODEL);
    const gateway = createAnthropic({
      baseURL: GATEWAY_BASE_URL,
      apiKey: process.env.AI_GATEWAY_API_KEY,
    });
    const { text } = await generateText({
      model: gateway(CLASSIFY_MODEL),
      prompt: [
        'Classify this servicer reply to a CEMA collateral-file request into exactly one word:',
        'delivered (they sent the file), rejected (they refuse/cannot), needs_info (they need more from us),',
        'or other. Reply with only the single word.',
        '',
        input.responseText,
      ].join('\n'),
    });
    const kind = text.trim().toLowerCase() as ServicerResponseKind;
    span.setAttribute('outreach.response_kind', VALID.includes(kind) ? kind : 'other');
    return { kind: VALID.includes(kind) ? kind : 'other' };
  });
}
