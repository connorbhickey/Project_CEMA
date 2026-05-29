/**
 * Borrower-facing CEMA savings narrative (spec §9.3 step 6, plan Task 7).
 *
 * This is the ONLY LLM-using surface of the Intake Agent — eligibility and
 * savings stay deterministic (legal correctness over model judgment). The
 * narrative is additive and env-gated: when no model key is configured the
 * agent runs end-to-end and simply emits no narrative (plan Decision 3).
 *
 * Mirrors the one existing LLM consumer in the repo (`@cema/search`'s query
 * classifier): the direct `anthropic(...)` provider reading `ANTHROPIC_API_KEY`,
 * not AI Gateway routing. Gateway routing (spec §4) is deferred like the WDK
 * wrap (plan Decision 1) and tracked for the M10 close-out ADR.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

import { buildSavingsNarrativePrompt } from './prompts/savings-narrative';
import type { NormalizedApplication, SavingsEstimate } from './types';

/** True when an Anthropic key is present — the gate that turns narrative drafting on. */
export function isLlmConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
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

  const { text } = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    prompt: buildSavingsNarrativePrompt(application, savings),
  });

  return text.trim();
}
