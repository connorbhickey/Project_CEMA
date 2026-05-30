import { createAnthropic } from '@ai-sdk/anthropic';
import { withChildSpan } from '@cema/observability';
import { trace } from '@opentelemetry/api';
import { generateText } from 'ai';

const tracer = trace.getTracer('@cema/agents-servicer-outreach');

const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
const GATEWAY_MODEL = 'anthropic/claude-sonnet-4.6';

export interface DraftEmailInput {
  readonly servicerName: string | null;
  readonly touchNumber: number;
  readonly dealReference: string;
}

export function isLlmConfigured(): boolean {
  return !!process.env.AI_GATEWAY_API_KEY;
}

/** Deterministic, always-valid B2B collateral-file request. The fallback when
 * the LLM is off or fails -- and the offline scorer target. Carries NO borrower
 * PII (no UPB, names, addresses) -- only the deal reference + servicer org name. */
export function renderTemplateEmail(input: {
  servicerName: string | null;
  touchNumber: number;
  dealReference: string;
}): {
  subject: string;
  body: string;
} {
  const salutation = input.servicerName
    ? `Dear ${input.servicerName} CEMA team,`
    : 'Dear CEMA processing team,';
  const nudge =
    input.touchNumber <= 1
      ? 'We are requesting the collateral file for the loan referenced below in connection with a New York CEMA.'
      : `This is follow-up #${input.touchNumber - 1} on our request for the collateral file referenced below.`;
  const body = [
    salutation,
    '',
    nudge,
    '',
    `Deal reference: ${input.dealReference}`,
    '',
    'Please provide the original note, recorded mortgage, all intervening assignments, and any prior CEMAs. Reply to this email with the documents or a status update.',
    '',
    'Thank you.',
  ].join('\n');
  return { subject: 'CEMA collateral file request', body };
}

export function buildOutreachEmailPrompt(input: DraftEmailInput): string {
  const tmpl = renderTemplateEmail(input);
  return [
    'You are a mortgage operations specialist writing a concise, professional B2B email',
    'to a loan servicer to request a collateral file for a New York CEMA.',
    'Rules: keep it under 150 words; professional and courteous; do NOT give legal advice;',
    'do NOT invent loan numbers, dollar amounts, names, or addresses; reference only the',
    'deal reference provided. Escalate politeness-appropriate urgency for later follow-ups.',
    '',
    `Servicer: ${input.servicerName ?? 'the servicing department'}`,
    `Follow-up number: ${input.touchNumber}`,
    `Deal reference: ${input.dealReference}`,
    '',
    'Here is a baseline template to improve (keep its intent and the deal reference):',
    tmpl.body,
  ].join('\n');
}

/**
 * Drafts the outbound email body. NEVER returns null (decision 3): the
 * deterministic template is the floor. When configured, the LLM polishes the
 * body; on any model failure we record the exception + outreach.draft_fallback
 * and return the template -- a late servicer follow-up must not fail on an
 * additive polish step. The subject is always the (safe) template subject.
 */
export async function draftOutreachEmail(
  input: DraftEmailInput,
): Promise<{ subject: string; body: string }> {
  const fallback = renderTemplateEmail(input);
  if (!isLlmConfigured()) return fallback;

  return withChildSpan(tracer, 'outreach.draft_email', async (span) => {
    span.setAttribute('gen_ai.request.model', GATEWAY_MODEL);
    span.setAttribute('outreach.touch_number', input.touchNumber);
    try {
      const gateway = createAnthropic({
        baseURL: GATEWAY_BASE_URL,
        apiKey: process.env.AI_GATEWAY_API_KEY,
      });
      const { text, usage } = await generateText({
        model: gateway(GATEWAY_MODEL),
        prompt: buildOutreachEmailPrompt(input),
      });
      if (usage) {
        span.setAttribute('gen_ai.usage.input_tokens', usage.promptTokens);
        span.setAttribute('gen_ai.usage.output_tokens', usage.completionTokens);
      }
      const body = text.trim();
      span.setAttribute('outreach.draft_fallback', body.length === 0);
      return body.length === 0 ? fallback : { subject: fallback.subject, body };
    } catch (err) {
      span.recordException(err as Error);
      span.setAttribute('outreach.draft_fallback', true);
      return fallback;
    }
  });
}
