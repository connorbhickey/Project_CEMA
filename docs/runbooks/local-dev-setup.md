# Local Development Setup — Project_CEMA

> Get from clone to working dev env in ~30 minutes. Tested 2026-05-13.

---

## Prerequisites

Before you start, confirm you have:

- **Node.js >= 22** — check with `node -v`. Use `nvm` (`.nvmrc` pins `22`) or `volta` to manage versions. On Windows, [nvm-windows](https://github.com/coreybutler/nvm-windows) works well.
- **Git** with SSH or HTTPS access to `github.com/connorbhickey/Project_CEMA`.
- **A configured commit-signing key** — branch protection requires signed commits. If you have not set this up, follow `docs/runbooks/signed-commits-setup.md` before your first commit.
- **A Neon account** with access to the project's dev database branch. Request from Connor. You will get a `DATABASE_URL` connection string for the dev branch.
- **A Clerk account** with access to the dev instance. Request from Connor. You will get `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_WEBHOOK_SECRET`.
- **(Optional) Vercel CLI** — needed only for `vercel env pull` in Step 2A. Install with `npm i -g vercel`.

---

## Step 1 — Clone and install (~5 min)

```bash
git clone git@github.com:connorbhickey/Project_CEMA.git
cd Project_CEMA
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install
```

Expected outcome: `pnpm-lock.yaml` resolves cleanly with no errors. Husky hooks initialize via the
`prepare` lifecycle script — you should see `husky` printed in the install output.

If `corepack enable` fails with a permissions error on Windows, run the terminal as Administrator
for that one command, then switch back.

---

## Step 2 — Provision environment variables (~10 min)

`apps/web/.env.local` is the single source of truth for local env vars. It is git-ignored and must
never be committed.

**Option A — Pull from Vercel (recommended for team members):**

```bash
vercel link        # one-time; select "connorbhickey's projects / project-cema" when prompted
vercel env pull apps/web/.env.local
```

This writes all environment variables from the Vercel "Development" environment into
`apps/web/.env.local`. Confirm the file now exists and contains `DATABASE_URL` and
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.

**Option B — Fill manually (for first-time setup when Vercel access is not yet provisioned):**

```bash
cp .env.example apps/web/.env.local
```

Open `apps/web/.env.local` and fill in at minimum:

```
DATABASE_URL=postgresql://...     # Neon dev branch connection string from Connor
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
```

The four Clerk routing URLs are non-secret and should be exactly these values in dev:

```
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
```

All other variables in `.env.example` are for Phase 1+ features not yet built. They can be left
empty for Phase 0 work.

---

## Step 3 — Run database migrations (~2 min)

Apply the Drizzle migrations to your Neon dev branch:

```bash
cd packages/db
pnpm db:migrate
```

`drizzle.config.ts` auto-loads `apps/web/.env.local` via dotenv when `DATABASE_URL` is not already
set as a shell variable, so running from `packages/db/` with the file present is sufficient.

Expected output: The Drizzle migration tracking table is created if missing, then both
`0000_purple_lester` and `0001_rls` are shown as applied.

Verify that RLS is active on the expected tables:

```bash
cd packages/db
pnpm tsx -e "
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
config({ path: '../../apps/web/.env.local' });
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true ORDER BY tablename\`
  .then(r => console.log('RLS on:', r.map(x => x.tablename).join(', ')));
"
```

Expected: `RLS on: attorney_approvals, audit_events, deals, documents, existing_loans, new_loans, parties, properties`

If `DATABASE_URL is required` is thrown, the env file is not found — re-check Step 2.

---

## Step 4 — Start the dev server (~1 min)

From the repo root:

```bash
cd ../..    # back to repo root if you are still in packages/db
pnpm dev
```

Turborepo runs `next dev --turbo` in `apps/web` (and `tsc --watch` in packages where applicable) in
parallel. Wait for the output line `✓ Ready in Xms` from Next.js.

Open `http://localhost:3000`. Clerk's middleware (`proxy.ts`) protects all non-public routes. You
will be redirected to `/sign-in`. Sign up with any email, create or join an organization, and you
should land on `/dashboard`.

Note: Neon dev branches auto-suspend after 5 minutes of inactivity. The first query after a
suspension wakes the branch in about 1 second — this is normal and shows up as a slow initial page
load, not an error.

---

## Step 5 — Verify the test suite (~3 min)

Run all checks from the repo root:

```bash
pnpm typecheck      # tsc --noEmit across all packages
pnpm lint           # ESLint with legacy config mode
pnpm format:check   # Prettier format validation
pnpm test           # 55 Vitest unit tests across all packages
pnpm build          # full Next.js production build
```

All five should complete without errors. If `pnpm test` fails with a connection error on the RLS
isolation test, that test requires `DATABASE_URL` to be set — see Step 2.

**Playwright e2e (requires a Clerk test user):**

```bash
cd apps/web
E2E_USER_EMAIL=<your-test-email> E2E_USER_PASSWORD=<your-test-password> pnpm test:e2e
```

The e2e spec starts the Next.js dev server automatically via Playwright's `webServer` config (120 s
timeout). It runs the happy path: sign in → create a Deal → verify it appears in the list.

**RLS isolation test (requires DATABASE_URL, hits real Neon dev branch):**

```bash
cd apps/web
pnpm test tests/integration/rls-isolation.test.ts
```

This test creates two test organizations, seeds a Deal under Org A, then proves that querying as
`cema_app_user` (BYPASSRLS=false) in Org B's RLS context returns zero rows for Org A's Deal. It
cleans up after itself.

---

## Working with the monorepo

### Package structure

```
packages/
  config/       # shared ESLint, Prettier, tsconfig — consumed by all other packages
  db/           # Drizzle schema, migrations, RLS helpers — @cema/db
  compliance/   # redactPii, emitAuditEvent, requireAttorneyApproval — @cema/compliance
  auth/         # Clerk wrappers, resolveOrganizationId — @cema/auth
  ui/           # shadcn-style components, Tailwind — @cema/ui
apps/
  web/          # Next.js 16 app (the processor workspace)
```

### Common commands

| Command            | What it does                                            |
| ------------------ | ------------------------------------------------------- |
| `pnpm dev`         | Start all apps + package watchers in parallel via Turbo |
| `pnpm test`        | Run all Vitest unit tests                               |
| `pnpm typecheck`   | `tsc --noEmit` on every package                         |
| `pnpm lint`        | ESLint on every package                                 |
| `pnpm format`      | Prettier write across all files                         |
| `pnpm build`       | Production build of all packages and apps               |
| `pnpm db:generate` | Generate a new Drizzle migration from schema changes    |
| `pnpm db:migrate`  | Apply pending migrations to the connected Neon branch   |
| `pnpm db:studio`   | Open Drizzle Studio (visual DB browser)                 |

### Adding a schema change

1. Edit the relevant schema file in `packages/db/src/schema/`.
2. `cd packages/db && pnpm db:generate` — Drizzle diffs against the current migration state and
   produces a new `.sql` file in `packages/db/migrations/`.
3. `pnpm db:migrate` — applies the new migration to your Neon dev branch.
4. Write tests. Run `pnpm typecheck && pnpm test` before committing.

### Environment variable naming

- `NEXT_PUBLIC_*` — exposed to the browser. Only non-secret values go here.
- Everything else — server-only. Accessed only in Server Components, Server Actions, or API routes.
- New env vars must be added to `.env.example` with a placeholder value and a comment. Never commit
  real values to `.env.example`.

---

## Troubleshooting

| Symptom                                                     | Likely cause                                                          | Fix                                                                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL is required` on any `pnpm` command            | `apps/web/.env.local` missing or empty                                | Re-run Step 2                                                                                                                              |
| Neon connection timeout on first request                    | Dev branch auto-suspended after idle                                  | Retry — first connection wakes the branch (~1 s)                                                                                           |
| `signed: N` appears in `git log --show-signature`           | Local repo config overrides global signing setting                    | Run `git config --local --unset commit.gpgsign` then re-enable signing globally                                                            |
| Husky `DEPRECATED` warning on every commit                  | v8 shim line still in hook files (known carry-over)                   | Ignore for now; will be removed in Phase 0 Month 2                                                                                         |
| ESLint reports flat-config format errors                    | `ESLINT_USE_FLAT_CONFIG=false` not propagated                         | All `lint` scripts in `package.json` include the `cross-env ESLINT_USE_FLAT_CONFIG=false` prefix; check the script did not get overwritten |
| `Module not found: @cema/db` in Turbopack                   | `.js` extension present in an import statement in a workspace package | Remove the `.js` extension — Turbopack resolves workspace TypeScript sources directly                                                      |
| `pnpm test:e2e` times out before the page loads             | Dev server slow to boot                                               | Increase `webServer.timeout` in `apps/web/playwright.config.ts` (current: 120 000 ms)                                                      |
| `Secret scan` check fails on PR                             | `GITGUARDIAN_API_KEY` not provisioned in repo secrets                 | This is a known carry-over. The check is non-blocking. Ask Connor about the API key.                                                       |
| Clerk `401` on webhook endpoint after `pnpm dev`            | `CLERK_WEBHOOK_SECRET` is wrong or missing                            | Verify the secret matches the Clerk dashboard webhook signing secret for the dev instance                                                  |
| RLS isolation test fails with `permission denied for table` | `cema_app_user` role not yet granted table privileges                 | The test provisions the role in `beforeAll` — ensure `DATABASE_URL` points to the same Neon branch where migrations were applied           |

---

## Reference documents

- `CLAUDE.md` — operating manual, 12 hard rules, tech stack, skills catalog (read first)
- `docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md` — authoritative product spec
- `docs/superpowers/plans/2026-05-12-phase-0-month-1-foundation.md` — Phase 0 Month 1 implementation plan
- `docs/adr/0001-phase-0-month-1-architecture.md` — what shipped and why (Phase 0 Month 1 ADR)
- `docs/runbooks/signed-commits-setup.md` — GPG / SSH commit signing setup
- `docs/runbooks/github-secrets.md` — GitHub Actions secrets reference
- `docs/runbooks/vercel-marketplace-provisioning.md` — Neon + Clerk Marketplace provisioning steps
- `docs/runbooks/renovate-setup.md` — Renovate GitHub App configuration
