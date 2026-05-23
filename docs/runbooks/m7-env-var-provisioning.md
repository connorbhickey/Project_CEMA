# M7 Env Var Provisioning — Typesense Cloud + Mem0

Run this runbook once per environment (preview → production) after M7 merges to main.

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

## 3. Deploy with new env vars

```bash
# Trigger a new Vercel deployment to pick up the new env vars
git push origin feat/m7-production-pipeline-entity-resolution
# Or after merge: the push to main triggers auto-deploy
```

Wait for the deployment to reach **Ready** in the Vercel dashboard.

---

## 4. Trigger embedding backfill

After deployment, trigger the backfill cron manually (rather than waiting for 2 AM UTC):

```bash
curl -s "https://<your-vercel-preview-url>/api/cron/backfill-embeddings" | jq
# Expected: { "commsQueued": N, "docsQueued": M }
```

Monitor the Vercel Queue dashboard to confirm embed jobs are consumed within ~5 minutes.

---

## 5. Smoke test

1. Open the app at your Vercel preview URL.
2. Navigate to **Search** (`/search`).
3. Enter a query that matches a known email subject (e.g. "payoff request").
4. Verify results include:
   - pgvector semantic hits (existing behavior)
   - Typesense full-text hits — identified by `preview: "(full-text match)"` in the result card
5. Perform the same search twice in the context of a deal to verify Mem0 memory context is prepended (check server logs for `memoryContext` entries).

---

## 6. Verify env gates are active

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
