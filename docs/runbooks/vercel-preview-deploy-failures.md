# Vercel Preview Deploy Failures Runbook

**Last updated:** 2026-06-05
**Owners:** Engineering (Connor)
**Related:** [`vercel-marketplace-provisioning.md`](vercel-marketplace-provisioning.md), CLAUDE.md §19 (CI failure tree), ADR-0001 (Neon branch-quota carry-over)

---

## Symptom

Every PR's **Vercel preview** deployment shows **"Vercel — fail"** (`Deployment has failed — run npx vercel inspect <id> --logs`), while **production** (`main`) deploys succeed (`Vercel: success`). Failing on every PR since at least #149 (2026-06).

It is **non-blocking**: the Vercel preview check is **not** a required merge gate (required = Lint, Typecheck, Unit tests, Build), so PRs still auto-merge — but the preview URL is unusable for design/QA review.

---

## Diagnosis (confirmed 2026-06-05)

The failure is **Preview-only**, happens **before the build runs**, and is **not the code or a missing env var**:

| Evidence                                                                            | How verified                                 | Conclusion                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| Preview = Error, Production = Success on the **same commit**                        | `gh api repos/.../deployments/<id>/statuses` | Not the code                                 |
| A **docs-only** PR (#150) preview also failed                                       | deployment history                           | Not the code diff                            |
| **No build logs**; `vercel inspect <dpl> --logs` returns nothing; `Builds: . [0ms]` | `vercel inspect`                             | Errored at **initialization, before build**  |
| **All** `DATABASE_*`, `CLERK_*`, `PII_ENCRYPTION_KEY` present in the Preview scope  | `vercel env ls`                              | **Not** a missing env var                    |
| `DATABASE_NEON_PROJECT_ID` present                                                  | `vercel env ls`                              | The **Vercel↔Neon integration is connected** |

→ A **Preview-specific provisioning step at deploy creation is failing.** The leading cause is the **Vercel↔Neon integration's per-preview database branch** step (Neon branch quota exhausted — the documented carry-over; each preview deploy creates a branch and they accumulate over time). Production reuses the main branch and never runs this step, so it is unaffected.

**Not yet confirmed:** the exact Vercel error code. It lives in the deployment's internal error (Vercel dashboard) or the Vercel API (the CLI token is in the OS keychain, not on disk), so it needs dashboard access — one click (below).

---

## Confirm (1 click)

1. **Vercel dashboard** → project `project-cema` → **Deployments** → open the failed preview (e.g. `project-cema-…-hicklax13s-projects.vercel.app`) → read the error banner / build log; it names the exact failing step.
   - _or_ **Neon Console** → the project (`DATABASE_NEON_PROJECT_ID`) → **Branches** → compare the branch count to the plan limit.

---

## Fix (requires dashboard access — Connor)

**If Neon branch quota is exhausted (most likely):**

- Delete the accumulated preview branches in the **Neon Console** (Branches → remove stale per-preview branches).
- Set the Vercel↔Neon integration to **auto-delete a preview branch when its PR closes** so they stop accumulating.
- Or upgrade the Neon plan for a higher branch limit.

**If the dashboard names a different cause** (integration disconnected, build-resource / usage limit): address per the message — re-authorize the integration in Vercel → Settings → Integrations, or check the account's Vercel usage limits.

---

## Evidence-gathering commands (for re-diagnosis)

```bash
# Recent deployments + which are preview vs production
gh api "repos/connorbhickey/Project_CEMA/deployments?per_page=4" \
  --jq '.[] | {id, env: .environment, ref: .ref[0:12]}'

# A deployment's status + Vercel's failure description + URL
gh api "repos/connorbhickey/Project_CEMA/deployments/<id>/statuses" \
  --jq '.[] | {state, desc: .description, url: .target_url}'

# Build logs (EMPTY == failed before the build started → infra/integration, not code)
vercel inspect <dpl_id> --logs

# Env var scopes (look for a Production-only var missing from Preview)
vercel env ls
```
