# GitHub Actions Secrets — Setup Runbook

> The workflows in `.github/workflows/` reference several secrets. None block Phase 0 Month 1 build, but adding them progressively unlocks more CI capabilities. This runbook lists what's needed and where to get it.

## Add a secret

```bash
gh secret set <NAME> --repo connorbhickey/Project_CEMA --body "<value>"
```

For sensitive values, prefer piping:

```bash
echo "<value>" | gh secret set <NAME> --repo connorbhickey/Project_CEMA
```

## Required secrets — by phase

### Phase 0 (Month 1) — none strictly required

The workflows that gate PRs (`ci.yml`, `dependency-review.yml`, `codeql.yml`, `license-check.yml`, `bundle-size.yml`, `stale.yml`) do **not** need any custom secrets. They use only the default `${{ secrets.GITHUB_TOKEN }}` which is auto-provided.

Phase 0 commits can ship without setting any custom secret.

### Phase 0 (Month 2+) — security scanning

| Secret                | Workflow            | Where to get                                                                                                                   |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GITGUARDIAN_API_KEY` | `security-scan.yml` | Sign up at [dashboard.gitguardian.com](https://dashboard.gitguardian.com) (free tier available) → API → Personal Access Tokens |
| `SNYK_TOKEN`          | `security-scan.yml` | Sign up at [snyk.io](https://snyk.io) (free tier) → Account Settings → API Token                                               |

Until both are added, those scan steps will skip with a warning rather than fail.

### Phase 1+ — Turbo remote cache (optional, performance)

| Secret                             | Variable               | Where to get                                                                                   |
| ---------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `TURBO_TOKEN`                      | (secret)               | Vercel: account.vercel.com → Settings → Tokens → Create Token (scope: read+write to your team) |
| `TURBO_REMOTE_CACHE_SIGNATURE_KEY` | (secret)               | Generate a random hex string: `openssl rand -hex 32`                                           |
| `TURBO_TEAM`                       | (variable, not secret) | Vercel team slug (e.g., `connorbhickey-projects`)                                              |

Add the variable: `gh variable set TURBO_TEAM --repo connorbhickey/Project_CEMA --body "your-team-slug"`

### Phase 1+ — LLM evals via Braintrust

These only matter for `llm-eval.yml`, which only triggers when files under `packages/agents/`, `packages/prompts/`, or `packages/idp/` change — those don't exist until Phase 1.

| Secret               | Where to get                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `BRAINTRUST_API_KEY` | [braintrust.dev](https://www.braintrust.dev) → Settings → API Keys (free tier available) |
| `AI_GATEWAY_API_KEY` | Vercel dashboard → AI Gateway → API Keys                                                 |
| `ANTHROPIC_API_KEY`  | [console.anthropic.com](https://console.anthropic.com) → API Keys                        |
| `OPENAI_API_KEY`     | [platform.openai.com](https://platform.openai.com) → API Keys                            |

### Phase 3+ — Voice agent vendor

| Secret                                                         | Where to get                                     |
| -------------------------------------------------------------- | ------------------------------------------------ |
| `TWILIO_ACCOUNT_SID`                                           | [console.twilio.com](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN`                                            | Same                                             |
| `CONDUIT_API_KEY` (or `SALIENT_*`, depending on vendor choice) | Per spec §17 pending decision                    |

## Required GitHub Actions VARIABLES (not secrets)

Variables are non-sensitive config. Set with `gh variable set <NAME> --body "..."`.

| Variable              | Purpose                                 | Default                                   |
| --------------------- | --------------------------------------- | ----------------------------------------- |
| `TURBO_TEAM`          | Turborepo remote cache team             | (none — turbo works without remote cache) |
| `PLAYWRIGHT_BASE_URL` | E2E target URL when not using webServer | `http://localhost:3000`                   |

## Required GitHub Environments (Phase 1+)

Create three environments for environment-scoped secrets:

```bash
gh api -X PUT repos/connorbhickey/Project_CEMA/environments/development
gh api -X PUT repos/connorbhickey/Project_CEMA/environments/preview
gh api -X PUT repos/connorbhickey/Project_CEMA/environments/production
```

Then add environment-specific secrets (e.g., a different `DATABASE_URL` per environment).

## Vercel-provisioned secrets (auto-managed)

If you provision Neon and Clerk via Vercel Marketplace (recommended — see runbook `vercel-marketplace-provisioning.md`), the following env vars are **auto-managed in Vercel** (not GitHub Actions):

- `DATABASE_URL` (Neon)
- `DATABASE_URL_UNPOOLED` (Neon)
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `BLOB_READ_WRITE_TOKEN` (when Vercel Blob is added)
- `UPSTASH_REDIS_REST_*` (when Upstash is added)

These flow into the Vercel build environment automatically; you do **not** need to mirror them into GitHub Actions secrets unless a workflow needs them outside the Vercel deploy.

## Audit which secrets are set

```bash
gh secret list --repo connorbhickey/Project_CEMA
gh variable list --repo connorbhickey/Project_CEMA
```
