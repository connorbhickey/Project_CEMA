# Vercel Marketplace Provisioning — Setup Runbook

> Step-by-step instructions for provisioning Neon Postgres and Clerk auth via the Vercel Marketplace. These steps require browser-based OAuth and cannot be automated from the CLI.

## Prerequisites

- Vercel account at `connorbhickey` team (or personal, if no team yet)
- GitHub repo connected: [connorbhickey/Project_CEMA](https://github.com/connorbhickey/Project_CEMA)
- Vercel CLI installed (`vercel --version` should print 51.x+)

## Step 1 — Create a Vercel project (one-time)

```bash
cd C:/Users/conno/Project_CEMA
vercel login
# Choose GitHub when prompted; browser opens to authorize
vercel link
```

When prompted:

- **Set up "Project_CEMA"?** Yes
- **Which scope?** `connorbhickey` (or your team)
- **Link to existing project?** No
- **Project name?** `project-cema`
- **Code directory?** `./` (we'll configure root dir to apps/web after)

This creates `.vercel/project.json` (already gitignored).

After `vercel link`, open the Vercel dashboard:

- Project Settings → Build & Development
- **Root Directory:** `apps/web`
- **Framework Preset:** Next.js
- **Install Command:** `corepack enable && pnpm install --frozen-lockfile`
- **Build Command:** `pnpm build`
- **Output Directory:** (leave default)

## Step 2 — Provision Neon Postgres

1. Open [vercel.com/marketplace/neon](https://vercel.com/marketplace/neon) in a browser.
2. Click **Install**.
3. Choose the `connorbhickey` Vercel team.
4. Choose **Free** plan to start (autoscales later).
5. Connect to project `project-cema`.
6. After install completes, the following env vars are auto-provisioned to all Vercel environments (development, preview, production):
   - `DATABASE_URL`
   - `DATABASE_URL_UNPOOLED`
   - `POSTGRES_HOST`
   - `POSTGRES_USER`
   - `POSTGRES_PASSWORD`
   - `POSTGRES_DATABASE`

7. Pull the env vars to local for dev:

   ```bash
   vercel env pull apps/web/.env.local
   ```

8. Verify:

   ```bash
   cat apps/web/.env.local | grep DATABASE_URL
   ```

   Expected: a `postgresql://...neon.tech...` URL.

## Step 3 — Provision Clerk auth

1. Open [vercel.com/marketplace/clerk](https://vercel.com/marketplace/clerk) in a browser.
2. Click **Install**.
3. Choose the `connorbhickey` Vercel team.
4. Choose **Free** plan to start.
5. Connect to project `project-cema`.
6. After install completes, the following env vars are auto-provisioned:
   - `CLERK_SECRET_KEY`
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`

7. Re-pull env vars:

   ```bash
   vercel env pull apps/web/.env.local
   ```

8. Open the Clerk dashboard (link is in the Vercel integration page after install).
9. **Critical step:** Enable Organizations.
   - Configure → Organizations → toggle **Enable Organizations** on.
   - **Default org role:** `member`
   - **Verified domains:** off (we don't use this in v1)
   - **Personal accounts:** off (force users into orgs)
10. Add a webhook endpoint:
    - Webhooks → Add Endpoint
    - URL: `https://<your-vercel-preview-or-prod-url>/api/webhooks/clerk` (you'll add this once the app deploys)
    - Subscribe to: `user.created`, `user.updated`, `organization.created`, `organization.updated`, `organizationMembership.created`, `organizationMembership.deleted`
    - Copy the signing secret → add to `apps/web/.env.local` as `CLERK_WEBHOOK_SECRET`
    - Also add to Vercel project env vars (Settings → Environment Variables)

## Step 4 — Verify the connection

```bash
cd C:/Users/conno/Project_CEMA
cat apps/web/.env.local | grep -E "DATABASE_URL|CLERK"
```

Expected output: at least 4 variables.

## Step 5 — Other Marketplace integrations (Phase 0 month 2+)

When ready:

- **Upstash Redis:** [vercel.com/marketplace/upstash](https://vercel.com/marketplace/upstash) — auto-provisions `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
- **Vercel Blob:** [vercel.com/dashboard/stores](https://vercel.com/dashboard/stores) → Create Store → Blob — auto-provisions `BLOB_READ_WRITE_TOKEN`
- **Sentry:** [vercel.com/marketplace/sentry](https://vercel.com/marketplace/sentry) — auto-provisions `SENTRY_DSN`

Pull env vars after each install:

```bash
vercel env pull apps/web/.env.local
```

## Troubleshooting

| Symptom                               | Cause                                                 | Fix                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `vercel link` errors out              | Not logged in                                         | `vercel login` first                                                                                                |
| `vercel env pull` says "no env vars"  | Project not linked or env vars haven't propagated yet | Wait 30s; re-run; confirm in Vercel dashboard                                                                       |
| Clerk webhook events not reaching app | Wrong endpoint URL or missing signing secret          | Confirm `CLERK_WEBHOOK_SECRET` matches Clerk dashboard; confirm endpoint URL is the deployed version, not localhost |
| Neon connections timing out           | Free tier auto-suspends after 5 min idle              | Normal — first connection wakes the branch, takes ~1s                                                               |
| Organizations not appearing           | Forgot to enable in Clerk dashboard                   | Configure → Organizations → toggle on                                                                               |
