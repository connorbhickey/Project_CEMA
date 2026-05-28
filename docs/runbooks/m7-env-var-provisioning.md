# Env Var Provisioning — Live Integrations (Typesense · Mem0 · Upstash · Cron)

Run this runbook once per environment (preview → production) to activate the
M6/M7/M9 integrations that ship behind env-gates. Until the keys below are set,
`isTypesenseConfigured()`, `isMemoryConfigured()`, and `isUpstashConfigured()`
all return `false` and the app degrades gracefully (no errors, reduced features).

## Prerequisites

- Vercel CLI installed and authenticated (`vercel whoami`)
- Access to the `connorbhickey/Project_CEMA` Vercel project
- `gh` CLI authenticated as `connorbhickey`

---

## 1. Typesense Cloud

### 1a. Create a cluster

1. Sign up or log in at [cloud.typesense.org](https://cloud.typesense.org)
2. Create a new cluster — choose `us-east-1` (closest to Neon default).
3. Wait for cluster status to reach **Running** (~5 min).
4. Under **Cluster → API Keys**, create a key with these permissions:
   `documents:get,documents:create,documents:upsert,documents:delete,collections:create,collections:get`
   Copy the key value.
5. Under **Cluster**, copy the **Hostname** (e.g. `abc123.a1.typesense.net` — no `https://` prefix).

### 1b. Add env vars to Vercel

```bash
# Preview environment
vercel env add TYPESENSE_API_KEY preview
vercel env add TYPESENSE_HOST preview       # hostname only, no https://
vercel env add TYPESENSE_PORT preview       # value: 443
vercel env add TYPESENSE_PROTOCOL preview   # value: https

# Production environment
vercel env add TYPESENSE_API_KEY production
vercel env add TYPESENSE_HOST production
vercel env add TYPESENSE_PORT production
vercel env add TYPESENSE_PROTOCOL production
```

### 1c. Create Typesense collections

After provisioning, the collections (`cema_communications`, `cema_documents`) are created lazily on first upsert. No manual schema creation needed — `@cema/typesense` uses `createIfNotExists` semantics.

---

## 2. Mem0

### 2a. Get API key

1. Sign up at [app.mem0.ai](https://app.mem0.ai)
2. Under **Settings → API Keys**, generate a new key. Copy it.

### 2b. Add env var to Vercel

```bash
# Preview
vercel env add MEM0_API_KEY preview

# Production
vercel env add MEM0_API_KEY production
```

---

## 3. Upstash Redis

Powers the sliding-window rate limiter (`@cema/cache`) on `/api/webhooks/*` and
SETNX webhook idempotency (M9). `isUpstashConfigured()` gates all calls, and the
proxy fails **open** on Redis error — so missing keys never block webhooks.

### 3a. Create a database

1. Sign up or log in at [console.upstash.com](https://console.upstash.com)
2. Create a **Redis** database — choose a region close to your Vercel deployment.
3. In the database's **REST API** section, copy `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.

### 3b. Add env vars to Vercel

```bash
# Preview
vercel env add UPSTASH_REDIS_REST_URL preview
vercel env add UPSTASH_REDIS_REST_TOKEN preview

# Production
vercel env add UPSTASH_REDIS_REST_URL production
vercel env add UPSTASH_REDIS_REST_TOKEN production
```

---

## 4. CRON_SECRET (recording-retention cron)

The monthly recording-retention cron (`/api/cron/recording-retention`, schedule
`0 3 1 * *`) authenticates via `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron
attaches this header automatically **once the env var exists** — but you must
still provision the value, and the route returns 401 on any mismatch.

### 4a. Generate + add the secret

```bash
# Generate a value
openssl rand -hex 32

# Preview
vercel env add CRON_SECRET preview

# Production
vercel env add CRON_SECRET production
```

> Set the **same** value in every environment where the cron should run.

---

## 5. Deploy with new env vars

```bash
# Trigger a new Vercel deployment to pick up the new env vars
git push origin feat/m7-production-pipeline-entity-resolution
# Or after merge: the push to main triggers auto-deploy
```

Wait for the deployment to reach **Ready** in the Vercel dashboard.

---

## 6. Trigger embedding backfill

After deployment, trigger the backfill cron manually (rather than waiting for 2 AM UTC):

```bash
curl -s "https://<your-vercel-preview-url>/api/cron/backfill-embeddings" | jq
# Expected: { "commsQueued": N, "docsQueued": M }
```

Monitor the Vercel Queue dashboard to confirm embed jobs are consumed within ~5 minutes.

---

## 7. Smoke test

1. Open the app at your Vercel preview URL.
2. Navigate to **Search** (`/search`).
3. Enter a query that matches a known email subject (e.g. "payoff request").
4. Verify results include:
   - pgvector semantic hits (existing behavior)
   - Typesense full-text hits — identified by `preview: "(full-text match)"` in the result card
5. Perform the same search twice in the context of a deal to verify Mem0 memory context is prepended (check server logs for `memoryContext` entries).

---

## 8. Verify env gates are active

If either service is unavailable, the app degrades gracefully:

- **Typesense missing:** `isTypesenseConfigured()` returns `false` → Typesense hits are skipped, pgvector-only results are returned.
- **Mem0 missing:** `isMemoryConfigured()` returns `false` → memory context is skipped, search still works.

No user-visible errors should appear if keys are temporarily missing.

---

## Rollback

If Typesense causes issues, remove the env var in Vercel and redeploy:

```bash
vercel env rm TYPESENSE_API_KEY production
```

The `isTypesenseConfigured()` gate means the application degrades gracefully — no restart or code change needed.
