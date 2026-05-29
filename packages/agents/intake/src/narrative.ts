/**
 * Borrower-facing CEMA savings narrative (spec §9.3 step 6, plan Task 7).
 *
 * This is the ONLY LLM-using surface of the Intake Agent — eligibility and
 * savings stay deterministic (legal correctness over model judgment). The
 * narrative is additive and env-gated: when no model key is configured the
 * agent runs end-to-end and simply emits no narrative (plan Decision 3).
 *
 * Routed through Vercel AI Gateway (spec §4): `createAnthropic` pointed at the
 * Gateway base URL, keyed on `AI_GATEWAY_API_KEY`, so model routing / cost /
 * failover are centralized rather than pinned to a direct Anthropic key. The
 * model call is traced as `intake.draft_narrative` carrying ONLY non-PII signal
 * (model id + token counts) — never the prompt, the response text, or any
 * borrower dollar figure (CLAUDE.md §10.3 / hard rule #3).
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { withChildSpan } from '@cema/observability';
import { trace } from '@opentelemetry/api';
import { generateText } from 'ai';

import { buildSavingsNarrativePrompt } from './prompts/savings-narrative';
import type { NormalizedApplication, SavingsEstimate } from './types';

/** Vercel AI Gateway endpoint — the OpenAI-compatible base the AI SDK posts to. */
const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

/**
 * Gateway model id (provider-prefixed, dot-versioned) — distinct from the direct
 * provider id `claude-sonnet-4-6`. UNCONFIRMED until `AI_GATEWAY_API_KEY` is
 * provisioned and a live call validates the exact slug (ADR 0012 carry-over).
 */
const GATEWAY_MODEL = 'anthropic/claude-sonnet-4.6';

/** Instrumentation scope — shared with the orchestrator (no-op until a provider registers). */
const tracer = trace.getTracer('@cema/agents-intake');

/** True when the Gateway key is present — the gate that turns narrative drafting on. */
export function isLlmConfigured(): boolean {
  return !!process.env.AI_GATEWAY_API_KEY;
}

/**
 * Draft a plain-language savings narrative for an eligible application.
 *
 * Returns `null` ONLY when the LLM is unconfigured (the narrative is an optional
 * enhancement, never a hard dependency). A configured-but-failed model call is
 * allowed to throw — `null` means "off", not "broken" — so the caller at the app
 * boundary can record the failure (e.g. Sentry) instead of silently dropping it.
 */
export async function draftSavingsNarrative(
  application: NormalizedApplication,
  savings: SavingsEstimate,
): Promise<string | null> {
  if (!isLlmConfigured()) {
    return null;
  }

  return withChildSpan(tracer, 'intake.draft_narrative', async (span) => {
    span.setAttribute('gen_ai.request.model', GATEWAY_MODEL);

    const gateway = createAnthropic({
      baseURL: GATEWAY_BASE_URL,
      apiKey: process.env.AI_GATEWAY_API_KEY,
    });

    const { text, usage } = await generateText({
      model: gateway(GATEWAY_MODEL),
      prompt: buildSavingsNarrativePrompt(application, savings),
    });

    if (usage) {
      span.setAttribute('gen_ai.usage.input_tokens', usage.promptTokens);
      span.setAttribute('gen_ai.usage.output_tokens', usage.completionTokens);
    }

    return text.trim();
  });
}
