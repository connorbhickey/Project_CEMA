export interface ContactDedupTextInput {
  readonly name?: string | null;
  readonly employer?: string | null;
  readonly email?: string | null;
}

/**
 * The canonical text to embed for FUZZY contact dedup (spec §9.1): the
 * human-identifying tokens — name, employer, and the local-part of the email
 * (the @domain rarely distinguishes people) — lowercased + whitespace-collapsed.
 *
 * Returns null when there's nothing identifying to embed (e.g. a phone-only
 * contact); the caller then skips embedding and relies on exact-match dedup.
 *
 * Pure: the caller embeds the returned text (via @cema/embeddings, gated on the
 * OpenAI key) and passes the vector to ensureContact — this package never calls
 * an embedding provider itself.
 */
export function buildContactDedupText(input: ContactDedupTextInput): string | null {
  const emailLocal = input.email ? input.email.split('@')[0] : null;
  const parts = [input.name, input.employer, emailLocal]
    .map((p) => p?.trim().toLowerCase())
    .filter((p): p is string => !!p && p.length > 0);
  if (parts.length === 0) return null;
  return parts.join(' ').replace(/\s+/g, ' ');
}
