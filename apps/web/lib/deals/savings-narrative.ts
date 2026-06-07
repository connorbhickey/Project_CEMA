export interface SavingsNarrative {
  readonly text: string;
  readonly generatedAt: string | null;
}

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v : null;

/**
 * Safely read the borrower-facing CEMA savings narrative the Intake Agent writes
 * to `deals.metadata.savingsNarrative` (`{ text, generatedAt }`) — the agent's
 * ONLY LLM surface, drafted best-effort after the deterministic Deal is created
 * (ADR 0010 #7). Returns null until a narrative exists (the LLM is env-gated, so
 * most deals have none). Pure + defensive against arbitrary jsonb.
 */
export function parseSavingsNarrative(metadata: unknown): SavingsNarrative | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const node = (metadata as Record<string, unknown>).savingsNarrative;
  if (typeof node !== 'object' || node === null) return null;

  const n = node as Record<string, unknown>;
  const text = asString(n.text);
  if (!text) return null;

  return { text, generatedAt: asString(n.generatedAt) };
}
