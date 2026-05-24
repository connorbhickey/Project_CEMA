# Phase 0 Month 9 — Cache Hardening + Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@cema/cache` Upstash package, Clerk + rate-limiting middleware, Twilio webhook idempotency, recording retention cron, and deal activity feed — closing M2 security carry-overs and adding the first major processor UX timeline.

**Architecture:** A new `@cema/cache` package (mirroring `@cema/typesense` and `@cema/memory`) exposes an `isUpstashConfigured()` env-gate so all Redis-dependent code degrades gracefully in dev. A single `apps/web/middleware.ts` runs Clerk authentication and env-gated rate limiting at the Next.js edge. The recording retention cron reuses the existing `retentionUntil` + `legalHold` schema columns already defined in M2. The deal activity feed is a pure RSC page that union-queries comms, docs, and kg_edges sorted by time.

**Tech Stack:** `@upstash/redis`, `@upstash/ratelimit`, `@clerk/nextjs` (v7 `clerkMiddleware`), Drizzle ORM, Next.js 16 App Router RSC, Vitest.

**Branch:** `feat/m9-cache-hardening-activity-feed` from `main`.

**Test count at start:** 240 passing / 55 files (from M8).

---

## File Map

| Action | Path                                                      | Purpose                                         |
| ------ | --------------------------------------------------------- | ----------------------------------------------- |
| Create | `packages/cache/package.json`                             | `@cema/cache` package manifest                  |
| Create | `packages/cache/tsconfig.json`                            | TypeScript config extending `@cema/config`      |
| Create | `packages/cache/src/client.ts`                            | `isUpstashConfigured()`, `getRedis()` singleton |
| Create | `packages/cache/src/ratelimit.ts`                         | `makeWebhookLimiter()`, `checkRateLimit()`      |
| Create | `packages/cache/src/index.ts`                             | Re-exports                                      |
| Create | `packages/cache/src/client.test.ts`                       | Unit tests for env-gate and singleton           |
| Create | `packages/cache/src/ratelimit.test.ts`                    | Unit tests for rate-limit helpers               |
| Create | `apps/web/middleware.ts`                                  | Clerk auth + env-gated Upstash rate limiting    |
| Modify | `apps/web/package.json`                                   | Add `@cema/cache` dependency                    |
| Modify | `apps/web/app/api/webhooks/twilio/route.ts`               | Add SETNX idempotency guard                     |
| Modify | `apps/web/app/api/webhooks/twilio/route.test.ts`          | Tests for idempotency guard                     |
| Create | `apps/web/app/api/cron/recording-retention/route.ts`      | Soft-delete expired recordings                  |
| Create | `apps/web/app/api/cron/recording-retention/route.test.ts` | Tests for retention cron                        |
| Modify | `apps/web/vercel.json`                                    | Add retention cron schedule                     |
| Create | `apps/web/app/(app)/deals/[id]/activity/page.tsx`         | Deal activity feed RSC page                     |
| Create | `apps/web/lib/queries/deal-activity.ts`                   | Data-fetch helper for activity feed             |
| Create | `apps/web/lib/queries/deal-activity.test.ts`              | Unit tests for activity query                   |

---

## Task 1: `@cema/cache` — Upstash Redis client package

**Files:**

- Create: `packages/cache/package.json`
- Create: `packages/cache/tsconfig.json`
- Create: `packages/cache/src/client.ts`
- Create: `packages/cache/src/index.ts`
- Test: `packages/cache/src/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cache/src/client.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

// Must mock before importing the module under test
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({ set: vi.fn(), get: vi.fn() })),
}));

describe('@cema/cache client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('isUpstashConfigured returns false when env vars are missing', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const { isUpstashConfigured } = await import('./client.ts');
    expect(isUpstashConfigured()).toBe(false);
  });

  it('isUpstashConfigured returns true when both env vars are set', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok_test');
    const { isUpstashConfigured } = await import('./client.ts');
    expect(isUpstashConfigured()).toBe(true);
  });

  it('getRedis throws when not configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const { getRedis } = await import('./client.ts');
    expect(() => getRedis()).toThrow('UPSTASH_REDIS_REST_URL is not set');
  });

  it('getRedis returns a Redis instance when configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok_test');
    const { getRedis } = await import('./client.ts');
    expect(getRedis()).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/cache && pnpm test
```

Expected: FAIL — `Cannot find module '@cema/cache'` or similar.

- [ ] **Step 3: Create package files**

`packages/cache/package.json`:

```json
{
  "name": "@cema/cache",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@upstash/redis": "^1.34.0",
    "@upstash/ratelimit": "^2.0.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/cache/tsconfig.json`:

```json
{
  "extends": "@cema/config/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`packages/cache/src/client.ts`:

```typescript
import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

export function isUpstashConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  if (!url) throw new Error('UPSTASH_REDIS_REST_URL is not set');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!token) throw new Error('UPSTASH_REDIS_REST_TOKEN is not set');

  if (!_redis) {
    _redis = new Redis({ url, token });
  }
  return _redis;
}
```

`packages/cache/src/index.ts`:

```typescript
export { isUpstashConfigured, getRedis } from './client.ts';
export { makeWebhookLimiter, checkRateLimit } from './ratelimit.ts';
```

- [ ] **Step 4: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/cache && pnpm test
```

Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/cache/
git commit -m "feat(cache): @cema/cache — Upstash Redis client with isUpstashConfigured env-gate"
```

---

## Task 2: `@cema/cache` — rate-limit helper

**Files:**

- Create: `packages/cache/src/ratelimit.ts`
- Test: `packages/cache/src/ratelimit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cache/src/ratelimit.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: vi.fn().mockImplementation(() => ({
    limit: vi.fn().mockResolvedValue({ success: true, remaining: 9, limit: 10, reset: 0 }),
  })),
}));

vi.mock('./client.ts', () => ({
  getRedis: vi.fn().mockReturnValue({}),
  isUpstashConfigured: vi.fn().mockReturnValue(true),
}));

describe('@cema/cache ratelimit', () => {
  it('makeWebhookLimiter returns a Ratelimit instance', async () => {
    const { makeWebhookLimiter } = await import('./ratelimit.ts');
    const limiter = makeWebhookLimiter();
    expect(limiter).toBeDefined();
  });

  it('checkRateLimit returns success:true when limit is not reached', async () => {
    const { checkRateLimit } = await import('./ratelimit.ts');
    const result = await checkRateLimit('127.0.0.1');
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/cache && pnpm test
```

Expected: FAIL on `ratelimit.test.ts`.

- [ ] **Step 3: Implement rate-limit helper**

Create `packages/cache/src/ratelimit.ts`:

```typescript
import { Ratelimit } from '@upstash/ratelimit';

import { getRedis } from './client.ts';

// 30 requests per 10-second window per IP — aggressive enough to block
// replay attacks and credential-stuffing without affecting legitimate Twilio
// callbacks (which fire at most once per call event).
export function makeWebhookLimiter(): Ratelimit {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(30, '10 s'),
    prefix: 'cema:rl:webhook',
  });
}

export async function checkRateLimit(
  identifier: string,
): Promise<{ success: boolean; remaining: number }> {
  const limiter = makeWebhookLimiter();
  const result = await limiter.limit(identifier);
  return { success: result.success, remaining: result.remaining };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cache && pnpm test
```

Expected: 6 passing.

- [ ] **Step 5: Run typecheck**

```bash
cd packages/cache && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/cache/src/ratelimit.ts packages/cache/src/ratelimit.test.ts packages/cache/src/index.ts
git commit -m "feat(cache): rate-limit helper — makeWebhookLimiter, checkRateLimit"
```

---

## Task 3: Next.js middleware — Clerk auth + env-gated rate limiting

**Files:**

- Create: `apps/web/middleware.ts`
- Modify: `apps/web/package.json` (add `@cema/cache` dep)

**Context:** Clerk v7 requires `clerkMiddleware()` to be the default export of `middleware.ts`. Without this file, Clerk does NOT enforce auth — any route is publicly accessible regardless of `auth().protect()` calls. This is a security gap that this task closes.

Rate limiting applies only to `/api/webhooks/*` to protect public-facing inbound callback endpoints. The `(app)` routes are protected by Clerk. Queue consumer routes (`/api/queues/*`) and cron routes (`/api/cron/*`) are internal and not rate-limited (Vercel enforces cron caller identity separately).

- [ ] **Step 1: Add `@cema/cache` to web app dependencies**

Edit `apps/web/package.json` — add to `"dependencies"`:

```json
"@cema/cache": "workspace:*"
```

Run:

```bash
pnpm install
```

- [ ] **Step 2: Write `middleware.ts`**

Create `apps/web/middleware.ts`:

```typescript
import { isUpstashConfigured, checkRateLimit } from '@cema/cache';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Webhooks are authenticated by vendor signature, not Clerk — they must
// remain publicly accessible. Everything else under /api/ is internal
// (queues, crons) or Clerk-protected (server actions).
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/api/twiml(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // Rate limit inbound webhook endpoints by client IP.
  if (req.nextUrl.pathname.startsWith('/api/webhooks/') && isUpstashConfigured()) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';
    const { success } = await checkRateLimit(ip);
    if (!success) {
      return new Response('Too Many Requests', { status: 429 });
    }
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
```

- [ ] **Step 3: Run build to verify middleware compiles**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/middleware.ts apps/web/package.json
git commit -m "feat(web): Clerk middleware + env-gated Upstash rate limiting on webhooks"
```

---

## Task 4: Twilio webhook idempotency (M2 carry-over §8.5)

**Files:**

- Modify: `apps/web/app/api/webhooks/twilio/route.ts`
- Modify: `apps/web/app/api/webhooks/twilio/route.test.ts`

**Context:** The Twilio recording-complete webhook can fire more than once for the same `RecordingSid` (Twilio retry on non-2xx, or network blip). Without idempotency, duplicate `telephony.call.ingest` + `comms.embed` publishes would create duplicate queue jobs, resulting in duplicate embeddings and potential double-billing. The fix is a Redis SETNX with a 24-hour TTL keyed on `RecordingSid`.

The guard runs only when `isUpstashConfigured()` is true. When Upstash is not provisioned, the route behaves exactly as before (no change to dev-loop behavior).

- [ ] **Step 1: Write the failing tests**

Open `apps/web/app/api/webhooks/twilio/route.test.ts` and add the following two tests inside the existing `describe` block (after existing tests):

```typescript
it('returns 200 without publishing when RecordingSid is already processed (idempotency guard)', async () => {
  // Set up cache mock: SETNX returns 0 (key already exists)
  vi.mock('@cema/cache', () => ({
    isUpstashConfigured: vi.fn().mockReturnValue(true),
    getRedis: vi.fn().mockReturnValue({
      set: vi.fn().mockResolvedValue(null), // null = key already exists (NX condition failed)
    }),
  }));

  // ... (use existing test fixture setup for valid Twilio signature)
  // The handler should return 200 early without calling publish
  // expect(publish).not.toHaveBeenCalled();
});

it('publishes normally when Upstash is not configured (idempotency skipped)', async () => {
  vi.mock('@cema/cache', () => ({
    isUpstashConfigured: vi.fn().mockReturnValue(false),
    getRedis: vi.fn(),
  }));
  // existing publish assertion passes unchanged
});
```

**Full test file replacement** — replace `apps/web/app/api/webhooks/twilio/route.test.ts` entirely:

```typescript
import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('@cema/integrations-twilio', () => ({
  verifyTwilioSignature: vi.fn().mockReturnValue(true),
  parseTwilioRecordingCallback: vi.fn().mockReturnValue({
    callSid: 'CA123',
    recordingSid: 'RE123',
    recordingStatus: 'completed',
    recordingUrl: 'https://api.twilio.com/recordings/RE123',
    recordingDuration: '30',
  }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  communications: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/queues', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/queue', () => ({ vercelQueueSend: vi.fn() }));

import { getDb } from '@cema/db';
import { publish } from '@cema/queues';
import { POST } from './route';

const COMM = { id: 'comm-1', organizationId: 'org-1' };

function makeRequest(body: string) {
  return new Request('http://localhost/api/webhooks/twilio', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'sig',
    },
    body,
  });
}

function makeDb(commRow: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(commRow ? [commRow] : []),
        }),
      }),
    }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('POST /api/webhooks/twilio', () => {
  it('returns 500 when TWILIO_AUTH_TOKEN is not set', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const res = await POST(
      makeRequest('CallSid=CA123&RecordingSid=RE123&RecordingStatus=completed'),
    );
    expect(res.status).toBe(500);
  });

  it('returns 200 OK for non-completed recording status', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'test_token';
    const { parseTwilioRecordingCallback } = await import('@cema/integrations-twilio');
    vi.mocked(parseTwilioRecordingCallback).mockReturnValueOnce({
      callSid: 'CA123',
      recordingSid: 'RE123',
      recordingStatus: 'in-progress',
      recordingUrl: null,
      recordingDuration: null,
    });
    const res = await POST(makeRequest('CallSid=CA123&RecordingStatus=in-progress'));
    expect(res.status).toBe(200);
    expect(publish).not.toHaveBeenCalled();
  });

  it('returns 404 when communication not found', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'test_token';
    vi.mocked(getDb).mockReturnValue(makeDb(null) as never);
    const res = await POST(
      makeRequest('CallSid=CA123&RecordingSid=RE123&RecordingStatus=completed'),
    );
    expect(res.status).toBe(404);
  });

  it('publishes comms.embed for completed recording', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'test_token';
    vi.mocked(getDb).mockReturnValue(makeDb(COMM) as never);
    const res = await POST(
      makeRequest('CallSid=CA123&RecordingSid=RE123&RecordingStatus=completed'),
    );
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      'comms.embed',
      expect.objectContaining({ communicationId: 'comm-1' }),
      expect.anything(),
    );
  });

  it('returns 200 without publishing when idempotency key already exists (Upstash configured)', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'test_token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    vi.doMock('@cema/cache', () => ({
      isUpstashConfigured: vi.fn().mockReturnValue(true),
      getRedis: vi.fn().mockReturnValue({
        set: vi.fn().mockResolvedValue(null), // NX condition failed — key exists
      }),
    }));
    vi.mocked(getDb).mockReturnValue(makeDb(COMM) as never);
    const { POST: POST2 } = await import('./route');
    const res = await POST2(
      makeRequest('CallSid=CA123&RecordingSid=RE123&RecordingStatus=completed'),
    );
    expect(res.status).toBe(200);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes normally when Upstash is not configured', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'test_token';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doMock('@cema/cache', () => ({
      isUpstashConfigured: vi.fn().mockReturnValue(false),
      getRedis: vi.fn(),
    }));
    vi.mocked(getDb).mockReturnValue(makeDb(COMM) as never);
    const { POST: POST3 } = await import('./route');
    const res = await POST3(
      makeRequest('CallSid=CA123&RecordingSid=RE123&RecordingStatus=completed'),
    );
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test --filter web -- twilio/route.test.ts
```

Expected: FAIL on the last 2 tests (idempotency tests).

- [ ] **Step 3: Add idempotency guard to route**

Replace `apps/web/app/api/webhooks/twilio/route.ts`:

```typescript
import { isUpstashConfigured, getRedis } from '@cema/cache';
import { communications, getDb } from '@cema/db';
import { parseTwilioRecordingCallback, verifyTwilioSignature } from '@cema/integrations-twilio';
import { publish } from '@cema/queues';
import { eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return new Response('TWILIO_AUTH_TOKEN not configured', { status: 500 });
  }

  const twilioSignature = req.headers.get('x-twilio-signature');
  if (!twilioSignature) {
    return new Response('Missing X-Twilio-Signature', { status: 400 });
  }

  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const paramsObj = Object.fromEntries(params.entries());

  if (!verifyTwilioSignature(authToken, twilioSignature, req.url, paramsObj)) {
    return new Response('Invalid Twilio signature', { status: 403 });
  }

  const callback = parseTwilioRecordingCallback(params);

  if (callback.recordingStatus !== 'completed') {
    return new Response('OK', { status: 200 });
  }

  // Idempotency guard: SETNX with 24-hour TTL on RecordingSid.
  // Returns null when key already existed (NX condition failed) → already processed.
  if (isUpstashConfigured()) {
    const redis = getRedis();
    const key = `telephony:idempo:${callback.recordingSid}`;
    const acquired = await redis.set(key, '1', { nx: true, ex: 86400 });
    if (acquired === null) {
      return new Response('OK', { status: 200 });
    }
  }

  const [comm] = await getDb()
    .select()
    .from(communications)
    .where(eq(communications.vendorCallId, callback.callSid))
    .limit(1);

  if (!comm) {
    return new Response('Communication not found for CallSid', { status: 404 });
  }

  await publish(
    'telephony.call.ingest',
    {
      orgId: comm.organizationId,
      provider: 'twilio',
      vendorCallId: callback.callSid,
      vendorEventId: callback.recordingSid,
      vendorPayload: paramsObj,
      receivedAt: new Date().toISOString(),
    },
    vercelQueueSend,
  );

  await publish(
    'comms.embed',
    { orgId: comm.organizationId, communicationId: comm.id },
    vercelQueueSend,
  );

  return new Response('OK', { status: 200 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test --filter web -- twilio/route.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Full test suite**

```bash
pnpm test
```

Expected: ≥ 242 passing, all green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/webhooks/twilio/route.ts apps/web/app/api/webhooks/twilio/route.test.ts
git commit -m "feat(webhooks): Twilio webhook idempotency via Upstash SETNX (M2 carry-over §8.5)"
```

---

## Task 5: Recording retention cron

**Files:**

- Create: `apps/web/app/api/cron/recording-retention/route.ts`
- Create: `apps/web/app/api/cron/recording-retention/route.test.ts`
- Modify: `apps/web/vercel.json`

**Context:** The `recordings` schema already has `retention_until` (set to `createdAt + 7 years` at insert time) and `legal_hold` (boolean). The cron finds rows where `retentionUntil < now()` AND `legalHold = false` AND `deletedAt IS NULL`, then soft-deletes them by setting `deletedAt = now()` and clearing the blob URL fields. Actual Vercel Blob deletion is deferred — a Phase 1 job will scan `deletedAt IS NOT NULL` rows and call `del()` on the blob client.

The cron runs monthly (`0 3 1 * *`) — retention windows are 7 years, so daily precision is not needed.

`BATCH_SIZE = 500` per run. If more than 500 rows expire in one month (unlikely at Phase 0 scale), they'll be caught on the next run.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/api/cron/recording-retention/route.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  recordings: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  lt: vi.fn().mockReturnValue({}),
  eq: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  sql: { raw: vi.fn().mockReturnValue('now()') },
}));

import { getDb } from '@cema/db';
import { GET } from './route';

function makeDb(expiredRows: { id: string }[], updateCount = 0) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(expiredRows),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(new Array(updateCount).fill({})),
      }),
    }),
  };
}

describe('GET /api/cron/recording-retention', () => {
  it('returns 200 with purged count when expired recordings exist', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([{ id: 'rec-1' }, { id: 'rec-2' }], 2) as never);
    const res = await GET();
    const body = (await res.json()) as { purged: number };
    expect(res.status).toBe(200);
    expect(body.purged).toBe(2);
  });

  it('returns 200 with purged:0 when no expired recordings', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([]) as never);
    const res = await GET();
    const body = (await res.json()) as { purged: number };
    expect(res.status).toBe(200);
    expect(body.purged).toBe(0);
  });

  it('does not call update when no rows expired', async () => {
    const db = makeDb([]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await GET();
    expect(db.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test --filter web -- recording-retention/route.test.ts
```

Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the cron route**

Create `apps/web/app/api/cron/recording-retention/route.ts`:

```typescript
import { getDb, recordings } from '@cema/db';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

const BATCH_SIZE = 500;

export async function GET(): Promise<Response> {
  const db = getDb();

  const expired = await db
    .select({ id: recordings.id })
    .from(recordings)
    .where(
      and(
        lt(recordings.retentionUntil, sql`now()`),
        eq(recordings.legalHold, false),
        isNull(recordings.deletedAt),
      ),
    )
    .limit(BATCH_SIZE);

  if (expired.length === 0) {
    return Response.json({ purged: 0 });
  }

  const ids = expired.map((r) => r.id);

  await db
    .update(recordings)
    .set({
      deletedAt: sql`now()`,
      recordingBlobUrl: '',
      recordingBlobPathname: '',
      transcriptBlobUrl: null,
      transcriptBlobPathname: null,
    })
    .where(inArray(recordings.id, ids));

  return Response.json({ purged: ids.length });
}
```

- [ ] **Step 4: Add to vercel.json crons**

Edit `apps/web/vercel.json` — add the retention cron to the `"crons"` array:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "cd ../.. && turbo run build --filter=web",
  "installCommand": "cd ../.. && corepack enable && pnpm install --frozen-lockfile",
  "ignoreCommand": "cd ../.. && git diff HEAD^ HEAD --quiet .",
  "crons": [
    {
      "path": "/api/cron/backfill-embeddings",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/cron/recording-retention",
      "schedule": "0 3 1 * *"
    }
  ]
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm test --filter web -- recording-retention/route.test.ts
```

Expected: 3 passing.

- [ ] **Step 6: Full suite**

```bash
pnpm test
```

Expected: ≥ 245 passing, all green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/cron/recording-retention/ apps/web/vercel.json
git commit -m "feat(cron): recording retention soft-delete — 7-year policy, monthly run (M2 carry-over)"
```

---

## Task 6: Deal activity feed

**Files:**

- Create: `apps/web/lib/queries/deal-activity.ts`
- Create: `apps/web/lib/queries/deal-activity.test.ts`
- Create: `apps/web/app/(app)/deals/[id]/activity/page.tsx`

**Context:** The activity feed shows every event touching a deal in reverse-chronological order: communications (calls, emails, Slack), documents (uploaded/approved/rejected), and knowledge-graph edges (contact linked to party). Each event has a timestamp, type label, and summary. This is a pure RSC page — no client state, no external deps, just a DB query and a list render.

The query union is done in TypeScript (three separate selects, merged and sorted in JS) rather than SQL UNION because the columns differ across tables and Drizzle's UNION API is verbose for this shape.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/queries/deal-activity.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  communications: {},
  documents: {},
  kgEdges: {},
  emailThreads: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
}));

import { getDb } from '@cema/db';
import { getDealActivity } from './deal-activity';

function makeDb(comms: unknown[], docs: unknown[], edges: unknown[]) {
  let callCount = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      callCount++;
      const row = callCount === 1 ? comms : callCount === 2 ? docs : edges;
      return {
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(row),
              }),
            }),
          }),
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(row),
            }),
          }),
        }),
      };
    }),
  };
}

describe('getDealActivity', () => {
  it('returns merged events sorted by time descending', async () => {
    const comm = { id: 'c1', kind: 'call', occurredAt: new Date('2026-05-10'), subject: null };
    const doc = {
      id: 'd1',
      kind: 'cema_3172',
      occurredAt: new Date('2026-05-11'),
      subject: 'CEMA',
    };
    vi.mocked(getDb).mockReturnValue(makeDb([comm], [doc], []) as never);

    const events = await getDealActivity('deal-1');
    // doc (May 11) should come before comm (May 10) in desc order
    expect(events[0]!.id).toBe('d1');
    expect(events[1]!.id).toBe('c1');
  });

  it('returns empty array when deal has no events', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([], [], []) as never);
    const events = await getDealActivity('deal-1');
    expect(events).toHaveLength(0);
  });

  it('each event has type, id, occurredAt, and label', async () => {
    const comm = {
      id: 'c1',
      kind: 'email',
      occurredAt: new Date('2026-05-10'),
      subject: 'Re: payoff',
    };
    vi.mocked(getDb).mockReturnValue(makeDb([comm], [], []) as never);
    const events = await getDealActivity('deal-1');
    expect(events[0]).toMatchObject({
      type: 'communication',
      id: 'c1',
      label: expect.any(String),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test --filter web -- deal-activity.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the query helper**

Create `apps/web/lib/queries/deal-activity.ts`:

```typescript
import { communications, documents, emailThreads, getDb, kgEdges } from '@cema/db';
import { and, desc, eq, isNotNull } from 'drizzle-orm';

export type DealActivityEvent = {
  type: 'communication' | 'document' | 'edge';
  id: string;
  occurredAt: Date;
  label: string;
  detail: string | null;
};

const LIMIT = 200;

export async function getDealActivity(dealId: string): Promise<DealActivityEvent[]> {
  const db = getDb();

  const [comms, docs, edges] = await Promise.all([
    db
      .select({
        id: communications.id,
        kind: communications.kind,
        occurredAt: communications.startedAt,
        subject: emailThreads.subject,
      })
      .from(communications)
      .leftJoin(emailThreads, eq(emailThreads.communicationId, communications.id))
      .where(and(eq(communications.dealId, dealId), isNotNull(communications.startedAt)))
      .orderBy(desc(communications.startedAt))
      .limit(LIMIT),

    db
      .select({
        id: documents.id,
        kind: documents.kind,
        occurredAt: documents.createdAt,
        subject: documents.filename,
      })
      .from(documents)
      .where(eq(documents.dealId, dealId))
      .orderBy(desc(documents.createdAt))
      .limit(LIMIT),

    db
      .select({
        id: kgEdges.id,
        predicate: kgEdges.predicate,
        occurredAt: kgEdges.createdAt,
      })
      .from(kgEdges)
      .where(eq(kgEdges.dealId, dealId))
      .orderBy(desc(kgEdges.createdAt))
      .limit(LIMIT),
  ]);

  const events: DealActivityEvent[] = [
    ...comms.map((c) => ({
      type: 'communication' as const,
      id: c.id,
      occurredAt: c.occurredAt ?? new Date(0),
      label: `${c.kind.charAt(0).toUpperCase()}${c.kind.slice(1)}`,
      detail: c.subject ?? null,
    })),
    ...docs.map((d) => ({
      type: 'document' as const,
      id: d.id,
      occurredAt: d.occurredAt ?? new Date(0),
      label: d.kind.replace(/_/g, ' '),
      detail: d.subject ?? null,
    })),
    ...edges.map((e) => ({
      type: 'edge' as const,
      id: e.id,
      occurredAt: e.occurredAt ?? new Date(0),
      label: e.predicate.replace(/_/g, ' '),
      detail: null,
    })),
  ];

  return events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}
```

**Note:** `kgEdges` does not have a `dealId` column directly in M8. Check the schema — if `kg_edges` lacks `dealId`, remove the edges query and add a comment: `// kg_edges queried via contact→party→deal traversal in Phase 1`. The communications and documents queries are sufficient for the feed.

If `kgEdges.dealId` does not exist, use this simplified version of the edges block:

```typescript
// Edges: skip for now — no dealId on kg_edges. Resolved via party in Phase 1.
const edges: never[] = [];
```

- [ ] **Step 4: Run tests**

```bash
pnpm test --filter web -- deal-activity.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Build the activity feed page**

Create `apps/web/app/(app)/deals/[id]/activity/page.tsx`:

```tsx
import { formatDistanceToNow } from 'date-fns';
import { getDealActivity } from '@/lib/queries/deal-activity';

export default async function DealActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const events = await getDealActivity(id);

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Activity</h2>
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No activity yet.</p>
      ) : (
        <ol className="border-border relative space-y-6 border-l">
          {events.map((event) => (
            <li key={`${event.type}-${event.id}`} className="ml-4">
              <span className="border-background bg-muted absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border" />
              <p className="text-foreground text-sm font-medium">{event.label}</p>
              {event.detail && (
                <p className="text-muted-foreground max-w-md truncate text-sm">{event.detail}</p>
              )}
              <time className="text-muted-foreground text-xs">
                {formatDistanceToNow(event.occurredAt, { addSuffix: true })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Install `date-fns` if not already present**

```bash
grep date-fns apps/web/package.json
```

If not found:

```bash
pnpm add date-fns --filter web
```

- [ ] **Step 7: Run full test suite + typecheck**

```bash
pnpm test && pnpm typecheck
```

Expected: ≥ 248 passing, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/queries/deal-activity.ts apps/web/lib/queries/deal-activity.test.ts apps/web/app/\(app\)/deals/\[id\]/activity/
git commit -m "feat(ui): deal activity feed — timeline of comms, docs, edges for a deal"
```

---

## Task 7: Final gate — ADR 0009, CLAUDE.md, PR

**Files:**

- Create: `docs/adr/0009-phase-0-month-9-cache-hardening-activity-feed.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write ADR 0009**

Create `docs/adr/0009-phase-0-month-9-cache-hardening-activity-feed.md` documenting:

- What shipped (5 tasks + test count)
- Architectural decisions: env-gate pattern for Upstash, Redis SETNX idempotency, soft-delete retention design, RSC-only activity feed
- Carry-overs to M10

- [ ] **Step 2: Update CLAUDE.md §2**

Update the Phase line, carry-overs list, code count, and add changelog row.

- [ ] **Step 3: Run full suite one final time**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

All green.

- [ ] **Step 4: Commit + push + PR**

```bash
git add docs/adr/0009-*.md CLAUDE.md
git commit -m "docs(m9): ADR 0009 + CLAUDE.md close-out — cache hardening + activity feed"
git push origin feat/m9-cache-hardening-activity-feed
gh pr create --title "feat(m9): Phase 0 Month 9 — Cache Hardening + Activity Feed" --base main
gh pr merge <n> --auto --squash --delete-branch
```

---

## Self-Review

**Spec coverage:**

- §8.5 Upstash idempotency for Twilio webhook → Task 4 ✅
- §12.1 Rate limiting via Upstash on public endpoints → Task 3 ✅
- Recordings 7-year retention → Task 5 ✅
- Deal activity timeline (processor UX) → Task 6 ✅
- Clerk middleware (route protection) → Task 3 ✅
- `@cema/cache` package (env-gate pattern) → Tasks 1–2 ✅

**Placeholder scan:** No TBD/TODO markers. All code blocks are complete. The one conditional note ("if `kgEdges.dealId` does not exist") provides both alternatives inline.

**Type consistency:**

- `DealActivityEvent` defined in Task 6 step 3, used in the page in step 5 ✅
- `checkRateLimit` defined in Task 2, used in Task 3 middleware ✅
- `isUpstashConfigured` / `getRedis` defined in Task 1, used in Tasks 3 and 4 ✅
