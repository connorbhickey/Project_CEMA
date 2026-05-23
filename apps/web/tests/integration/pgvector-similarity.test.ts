// apps/web/tests/integration/pgvector-similarity.test.ts
/**
 * pgvector similarity smoke test (M5 Task 28).
 *
 * Inserts two communications with hand-crafted embeddings (orthogonal
 * and near-identical) and verifies the cosine ordering matches
 * expectation. Does NOT exercise the OpenAI API — embeddings are
 * provided directly so the test runs offline.
 */

import { communications, getDb, organizations, users } from '@cema/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORG_ID = '00000000-0000-0000-0000-0000000000a6';
const USER_ID = '00000000-0000-0000-0000-000000000096';

const skip = !process.env.DATABASE_URL;

// Hand-crafted 3072-dim vectors.
const VEC_A = new Array(3072).fill(0).map((_, i) => (i === 0 ? 1 : 0)); // [1, 0, 0, ...]
const VEC_A_NEAR = new Array(3072).fill(0).map((_, i) => (i === 0 ? 0.99 : i === 1 ? 0.01 : 0));
const VEC_B = new Array(3072).fill(0).map((_, i) => (i === 1 ? 1 : 0)); // [0, 1, 0, ...]

let commAId: string;
let commANearId: string;
let commBId: string;

describe.skipIf(skip)('pgvector similarity smoke', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({ id: ORG_ID, clerkOrgId: 'org_pgvector', name: 'pgvector test', slug: 'pgv-test' })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_pgvector', email: 'pgvector@example.invalid' })
      .onConflictDoNothing();

    const [a] = await db
      .insert(communications)
      .values({
        organizationId: ORG_ID,
        kind: 'email',
        direction: 'inbound',
        medium: 'gmail',
        status: 'ready',
        vendorEventId: 'pgv-A',
        embedding: VEC_A,
      })
      .returning();
    commAId = a!.id;

    const [aNear] = await db
      .insert(communications)
      .values({
        organizationId: ORG_ID,
        kind: 'email',
        direction: 'inbound',
        medium: 'gmail',
        status: 'ready',
        vendorEventId: 'pgv-A-near',
        embedding: VEC_A_NEAR,
      })
      .returning();
    commANearId = aNear!.id;

    const [b] = await db
      .insert(communications)
      .values({
        organizationId: ORG_ID,
        kind: 'email',
        direction: 'inbound',
        medium: 'gmail',
        status: 'ready',
        vendorEventId: 'pgv-B',
        embedding: VEC_B,
      })
      .returning();
    commBId = b!.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db
      .delete(communications)
      .where(inArray(communications.id, [commAId, commANearId, commBId]));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_ID]));
  });

  it('orders A_near closer to A than B (cosine)', async () => {
    const db = getDb();
    const vecALiteral = sql.raw(`'[${VEC_A.join(',')}]'::vector`);
    const rows = await db
      .select({
        id: communications.id,
        distance: sql<number>`${communications.embedding} <=> ${vecALiteral}`,
      })
      .from(communications)
      .where(eq(communications.organizationId, ORG_ID))
      .orderBy(sql`${communications.embedding} <=> ${vecALiteral}`);

    // Expected ordering: A (distance ~0), A_near (small), B (large)
    expect(rows[0]?.id).toBe(commAId);
    expect(rows[1]?.id).toBe(commANearId);
    expect(rows[2]?.id).toBe(commBId);
  });
});
