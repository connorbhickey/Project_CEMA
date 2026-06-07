/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { contactIdentities, contacts } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { normalizeEmail, normalizePhone } from './normalize';
import {
  DEFAULT_SIMILARITY_MAX_DISTANCE,
  findSimilarContacts,
  isValidEmbedding,
} from './similarity';

// Identity kinds for which a fuzzy (name/employer embedding) fallback is SAFE:
// people legitimately have multiple emails/phones, so consolidating by name
// similarity helps. Authoritative external IDs (crm_id, slack_user) are excluded
// — an exact miss there is a genuinely new mapping, and a name-similarity merge
// would wrongly attach the external id to the wrong contact (a hard-to-unwind
// data-integrity error).
const FUZZY_DEDUP_KINDS = new Set<DedupKind>(['email', 'phone']);

export type DedupKind = 'email' | 'phone' | 'slack_user' | 'crm_id';
export type DedupSource = 'party' | 'comm_from' | 'comm_to' | 'slack_message' | 'manual';

export interface EnsureContactInput {
  orgId: string;
  kind: DedupKind;
  value: string;
  source: DedupSource;
  sourceId: string | null;
  name?: string | null;
  employer?: string | null;
  slackTeamId?: string;
  confidence?: number;
  /**
   * Optional name/employer embedding (build via buildContactDedupText + embed it,
   * gated on the OpenAI key). When present, a normalized-value miss falls back to
   * a FUZZY similarity pass before creating a new contact — so "Bob Smith" and
   * "Robert Smith" at the same firm collapse to one contact (spec §9.1). When
   * absent, behavior is unchanged (exact email/phone dedup only).
   */
  embedding?: number[];
  /** Timestamp the embedding was generated (stored alongside it). */
  embeddingGeneratedAt?: Date;
  /** Cosine-distance threshold for the fuzzy pass (default 0.15). */
  similarityMaxDistance?: number;
}

export interface EnsureContactResult {
  contactId: string;
  created: boolean;
  /** How the contact was resolved: a normalized-value hit, a fuzzy embedding hit,
   *  or a fresh insert. 'exact'/'similarity' both imply created === false. */
  matchedBy: 'exact' | 'similarity' | 'created';
}

// Loosely-typed tx parameter to keep the package independent of drizzle's
// transaction type details. The caller is responsible for wrapping in
// withRls(orgId, ...) before invoking.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export async function ensureContact(
  tx: Tx,
  input: EnsureContactInput,
): Promise<EnsureContactResult | null> {
  const normalized = normalizeForKind(input.kind, input.value, input.slackTeamId);
  if (!normalized) return null;

  const existing = await tx
    .select({ contactId: contactIdentities.contactId })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.organizationId, input.orgId),
        eq(contactIdentities.kind, input.kind),
        eq(contactIdentities.normalizedValue, normalized),
      ),
    )
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    return { contactId: existing[0].contactId, created: false, matchedBy: 'exact' };
  }

  // Sanitize the embedding ONCE: pgvector enforces dimension + finiteness on write
  // AND in <=>, so a malformed embedding (wrong length / NaN / Infinity) would
  // hard-fail both the fuzzy lookup and the contacts insert. Reuse the sanitized
  // value for both; an invalid embedding degrades to no-fuzzy + a NULL column.
  const validEmbedding = isValidEmbedding(input.embedding) ? input.embedding : null;

  // Fuzzy pass: only for alias-prone kinds (email/phone) with a well-formed
  // embedding — link this new identity to a near-duplicate contact instead of
  // creating a redundant one. Conservative threshold avoids false merges; a miss
  // (or an authoritative kind / missing embedding) falls through to a fresh contact.
  if (FUZZY_DEDUP_KINDS.has(input.kind) && validEmbedding) {
    const [match] = await findSimilarContacts(tx, {
      orgId: input.orgId,
      embedding: validEmbedding,
      maxDistance: input.similarityMaxDistance ?? DEFAULT_SIMILARITY_MAX_DISTANCE,
      limit: 1,
    });
    if (match) {
      await tx
        .insert(contactIdentities)
        .values({
          contactId: match.contactId,
          organizationId: input.orgId,
          kind: input.kind,
          normalizedValue: normalized,
          rawValue: input.value,
          source: input.source,
          sourceId: input.sourceId,
          confidence: input.confidence ?? 1.0,
        })
        .onConflictDoNothing();
      return { contactId: match.contactId, created: false, matchedBy: 'similarity' };
    }
  }

  const inserted = await tx
    .insert(contacts)
    .values({
      organizationId: input.orgId,
      primaryName: input.name ?? null,
      primaryEmail: input.kind === 'email' ? normalized : null,
      primaryPhone: input.kind === 'phone' ? normalized : null,
      employer: input.employer ?? null,
      // Sanitized: a malformed embedding persists NULL rather than failing the
      // pgvector(3072) write (dimension + finite-element enforcement).
      embedding: validEmbedding,
      embeddingGeneratedAt: validEmbedding ? (input.embeddingGeneratedAt ?? null) : null,
    })
    .returning();

  const newContact = inserted[0];
  if (!newContact) throw new Error('Failed to insert contacts row');

  await tx
    .insert(contactIdentities)
    .values({
      contactId: newContact.id,
      organizationId: input.orgId,
      kind: input.kind,
      normalizedValue: normalized,
      rawValue: input.value,
      source: input.source,
      sourceId: input.sourceId,
      confidence: input.confidence ?? 1.0,
    })
    .onConflictDoNothing();

  return { contactId: newContact.id, created: true, matchedBy: 'created' };
}

function normalizeForKind(kind: DedupKind, value: string, slackTeamId?: string): string | null {
  switch (kind) {
    case 'email':
      return normalizeEmail(value);
    case 'phone':
      return normalizePhone(value);
    case 'slack_user':
      return slackTeamId ? `${slackTeamId.toLowerCase()}:${value.toLowerCase()}` : null;
    case 'crm_id':
      return value.trim();
  }
}
