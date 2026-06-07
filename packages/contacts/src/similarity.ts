/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { contacts } from '@cema/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

// Loosely-typed tx (same as dedup.ts) to keep the package independent of
// drizzle's transaction-type details. Caller wraps in withRls(orgId, ...).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export interface SimilarContact {
  readonly contactId: string;
  readonly distance: number;
}

export interface FindSimilarContactsArgs {
  readonly orgId: string;
  readonly embedding: number[];
  /** Max cosine distance (pgvector <=>: 0=identical .. 2=opposite) counted a match. */
  readonly maxDistance: number;
  readonly limit?: number;
}

/** Default fuzzy-dedup threshold: cosine distance <= 0.15 (~>= 0.925 similarity).
 *  Conservative to avoid false merges; caller-tunable per source confidence. */
export const DEFAULT_SIMILARITY_MAX_DISTANCE = 0.15;

/** Dimensionality of `contacts.embedding` (vector(3072), text-embedding-3-large). */
export const EMBEDDING_DIMENSIONS = 3072;

/**
 * A WELL-FORMED pgvector(3072) value: a 3072-length array of finite numbers.
 * pgvector strictly enforces BOTH the dimension and finiteness on write AND in the
 * `<=>` operator — a wrong-length or NaN/Infinity vector raises a hard error
 * (`different vector dimensions X and Y`, `NaN not allowed in vector`). Callers
 * gate on this so a malformed embedding soft-misses (returns []/persists NULL)
 * instead of crashing the similarity query or the contacts insert.
 */
export function isValidEmbedding(v: number[] | null | undefined): v is number[] {
  return (
    Array.isArray(v) && v.length === EMBEDDING_DIMENSIONS && v.every((n) => Number.isFinite(n))
  );
}

/**
 * Nearest contacts within `maxDistance` of `embedding`, scoped to one org and
 * ordered nearest-first. Brute-force cosine scan — no vector index (pgvector
 * cannot index > 2000 dims and an org's contact set is small). Injection-safe:
 * the vector is BOUND as a parameter then cast `::vector` (not string-interpolated).
 * A malformed embedding (wrong dimension / non-finite) short-circuits to [] rather
 * than hard-failing the `<=>` query with `different vector dimensions X and Y`.
 */
export async function findSimilarContacts(
  tx: Tx,
  args: FindSimilarContactsArgs,
): Promise<SimilarContact[]> {
  const { orgId, embedding, maxDistance, limit = 5 } = args;
  if (!isValidEmbedding(embedding)) return [];

  const vectorString = `[${embedding.join(',')}]`;
  const distance = sql<number>`${contacts.embedding} <=> ${vectorString}::vector`;

  const rows: Array<{ contactId: string; distance: number }> = await tx
    .select({ contactId: contacts.id, distance })
    .from(contacts)
    .where(and(eq(contacts.organizationId, orgId), isNotNull(contacts.embedding)))
    .orderBy(distance)
    .limit(limit);

  return rows
    .filter((r) => r.distance <= maxDistance)
    .map((r) => ({ contactId: r.contactId, distance: r.distance }));
}
