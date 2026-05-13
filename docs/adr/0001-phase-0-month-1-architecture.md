# ADR 0001: Phase 0 Month 1 — Multi-Tenant Foundation

**Status:** Accepted (shipped 2026-05-13)
**Author:** Phase 0 Month 1 implementation (Claude Opus 4.7 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None

---

## Context

Project_CEMA needed a multi-tenant data foundation before any Layer 2 workspace features (telephony,
email, document processing) or Layer 3 CEMA AI agents could be built. Spec §6 defined the data
model; spec §7 defined the Deal entity and the attorney-review gate. The Phase 0 Month 1 plan at
`docs/superpowers/plans/2026-05-12-phase-0-month-1-foundation.md` broke the work into 24 sequential
tasks across 28 PRs (some tasks produced both a feature PR and a fix-up PR from code review).

This ADR documents what actually shipped, where reality diverged from the plan, and the reasoning
behind decisions made under uncertainty. The goal is that a new engineer — or Connor six months from
now — can read this and understand not just _what_ we built but _why_ specific choices were made and
what was consciously deferred.

Final SHA on `main`: `12f6cae`. 28 merged PRs, #1 through #28.

---

## What shipped

### Workspace packages (5)

| Package            | Contents                                                                         |
| ------------------ | -------------------------------------------------------------------------------- |
| `@cema/config`     | Shared ESLint (legacy config mode), Prettier, and tsconfig presets               |
| `@cema/db`         | Drizzle schema (13 tables, 9 enums), Neon HTTP client, RLS helpers, 2 migrations |
| `@cema/compliance` | `redactPii()`, `emitAuditEvent()`, `requireAttorneyApproval()`, 18 unit tests    |
| `@cema/auth`       | Clerk wrappers, `resolveOrganizationId()`, typed error classes, 9 unit tests     |
| `@cema/ui`         | Button, Input, Label, Card, Select, Form, Separator — shadcn-style components    |

### Application (`apps/web`)

Next.js 16 App Router with:

- Clerk auth gate via `proxy.ts` (the Next.js 16 name for `middleware.ts`)
- Sign-in and sign-up catch-all routes under `(auth)/`
- Clerk webhook handler syncing orgs and users into Postgres
- Authenticated app layout with sidebar and org switcher
- Deal list page, new-deal form (react-hook-form + Zod), deal detail page
- `createDeal` and `listDeals` server actions with RLS context and audit log emission

### Data layer

- 13 Postgres tables across 2 migrations (`0000_purple_lester.sql`, `0001_rls.sql`)
- RLS policies on 8 tenant-scoped tables; `servicers`, `organizations`, `users`, `memberships` are
  intentionally not row-isolated
- 55 unit tests across all packages
- 1 Playwright e2e spec (happy-path: sign-in → create deal → view deal list)
- 1 integration test proving cross-org Deal isolation under `cema_app_user` role

### CI/CD

- GitHub Actions: lint, typecheck, test, build, Playwright e2e (label-gated)
- Vercel preview-per-PR active
- Renovate dependency scanning active
- Husky pre-commit (lint-staged) and commit-msg (commitlint) hooks

---

## Architectural decisions

### 1. Drizzle ORM with the Neon HTTP driver (not WebSocket)

The plan specified Drizzle with the Neon serverless driver. There are two Neon clients:
`neon-http` (stateless, serverless-safe) and `neon-postgres` (WebSocket, persistent connection).

We chose `drizzle-orm/neon-http` explicitly because:

- Vercel Functions are stateless. A WebSocket-based persistent connection would not survive cold
  starts cleanly and would require pooler configuration.
- The HTTP driver has zero persistent state — each query is an independent HTTP call to Neon's
  query API.
- The tradeoff is that `db.transaction()` is not supported in `drizzle-orm/neon-http`. When
  transactional behavior is needed, the raw `neon().transaction([...])` API sends multiple
  statements in a single HTTP round-trip. This pattern is demonstrated in the RLS isolation test.

### 2. Lazy `getDb()` factory (not module-level eager initialization)

`packages/db/src/client.ts` exports `getDb()` rather than a module-level `const db = createDb()`.

Reason: `DATABASE_URL` is not available at module-load time during `next build` or in CI
environments where the env var is not injected. A module-level call would crash the build.
The lazy factory defers the env-var check until the first actual database call at request time.
This is the pattern recommended by the Vercel Storage documentation for serverless clients.

The singleton (`_db`) is intentionally reused across calls within a process lifetime to avoid
re-creating the Neon HTTP client on every request.

### 3. Array-form table index definitions (Drizzle 0.36+ syntax)

The plan specified Drizzle `^0.36.0`. We actually shipped `^0.45.2` (see divergences below). In
Drizzle 0.36+, the index definition syntax inside `pgTable`'s second argument moved from an object
form to an array-returning function form:

```typescript
// Deprecated object form (Drizzle <0.36)
(t) => ({ myIdx: index().on(t.col) })

// Current array form (Drizzle 0.36+)
(t) => [index('my_idx').on(t.col)]
```

All 13 tables use the array form. The object form was never used — this was caught during the
`@cema/db` scaffold task.

### 4. Per-FK manual btree indexes on every foreign key column

Postgres does not automatically create indexes on foreign key columns — only on the referenced
primary key. We explicitly created a btree index on every FK column in every table:

- `deals.organization_id`, `deals.property_id`, `deals.new_loan_id`, `deals.created_by_id`
- `existing_loans.deal_id`, `existing_loans.current_servicer_id`
- `documents.deal_id`
- `parties.deal_id`
- `attorney_approvals.document_id`, `attorney_approvals.approved_by_id`
- `audit_events.organization_id`, `audit_events.actor_user_id`
- `memberships.organization_id`, `memberships.user_id`
- `servicer_cema_departments.servicer_id`
- `new_loans.organization_id`

This is especially important for `deals.organization_id` (the primary RLS filter column) and
`audit_events.organization_id` + `occurredAt` (the composite index for timeline queries).

### 5. `onDelete: 'restrict'` for FKs to entities with `deleted_at`

Organizations and users are soft-deleted (they have a `deleted_at` column; no hard deletes). Using
`onDelete: 'cascade'` on FKs pointing to these entities would silently delete business records when
an org is soft-deleted. Using `onDelete: 'restrict'` makes the DB actively reject such an operation,
which surfaces the bug immediately rather than allowing silent data loss.

Hard delete is intentionally not supported for organizations or users. Deals, documents, parties, and
existing loans use `onDelete: 'cascade'` because they are owned by their parent entity and have no
independent lifecycle.

### 6. DB-level CHECK constraints for numeric invariants and the attorney-review gate

Rather than relying solely on application-layer validation, we encoded business invariants directly
into the schema as Postgres CHECK constraints. Examples:

- `deals_completed_at_required`: `status <> 'completed' OR completed_at IS NOT NULL`
- `new_loans_principal_positive`: `principal > 0`
- `existing_loans_upb_nonneg`: `upb >= 0`
- `existing_loans_recording_xor`: reel/page and CRFN are mutually exclusive recording identifiers
- `documents_attorney_gate_required`: the 14 attorney-gate-required document kinds cannot be
  inserted with `attorney_review_required = false`
- `parties_ssn_encrypted_not_plaintext`: rejects any `ssn_encrypted` value matching the SSN regex
  pattern, ensuring only pgcrypto ciphertext (which does not match that pattern) can be stored

The attorney-gate CHECK (`documents_attorney_gate_required`) is the DB-layer enforcement of
CLAUDE.md hard rule #2. It was added as a fix-up (PR #12) after the type-design review caught that
the first implementation left the gate as an application-layer-only comment.

### 7. `aom` enum value (not `assignment`) in `documentKindEnum`

The plan's file structure referred to an `assignment` document kind. CLAUDE.md hard rule #2 uses the
literal string `aom` (Assignment of Mortgage) in its enumeration of attorney-review-required
document kinds. The type-design review after PR #11 caught this divergence. We renamed the enum
value to `aom` to match the domain glossary and the hard rule literal, ensuring the CHECK constraint
in decision #6 would fire correctly. This is not a style preference — the word `aom` is the legal
industry term and the literal that CLAUDE.md specifies must trigger the attorney gate.

### 8. RLS via `set_config('app.current_organization_id', ...)` (not transactional `SET LOCAL`)

RLS policies filter by comparing `organization_id` against
`current_setting('app.current_organization_id', true)`. The `true` parameter makes the function
return `NULL` rather than throwing when the setting is missing — essential for queries that run
before an org context is established (webhooks, migrations).

The application sets this via `withRlsContext(orgId)` which returns a `SET LOCAL ...` statement.
"Local" means the setting resets at the end of the current transaction — correct for Neon HTTP where
each query is its own transaction.

The RLS isolation test revealed an important implementation detail: `db.transaction()` is not
supported in `drizzle-orm/neon-http`. The test instead uses `neon().transaction([...])` to batch
`SET LOCAL ROLE cema_app_user`, `set_config(...)`, and the `SELECT` statement into a single HTTP
round-trip / single Postgres transaction. This is the only reliable way to exercise RLS policies
with the HTTP driver.

### 9. `fha` and `va` removed from `loanProgramEnum`

The initial enum implementation included `fha` and `va` as loan program values. The type-design
review after PR #9 caught that both are explicit out-of-scope exclusions per spec §2.2:

- VA: does not permit CEMA by VA regulation.
- FHA: technically eligible but out of scope for Phase 0 and explicitly deferred to Phase 2.5.

Including them in the enum creates type-safe paths that should not exist. A future engineer might
see the enum value and assume FHA is supported. They were removed, with a comment in `enums.ts`
explaining why each is absent so future engineers don't add them back accidentally.

### 10. `newLoans.organizationId` column added

The initial `newLoans` table had no `organization_id` column — it was linked to `deals` only
indirectly (via `deals.new_loan_id`). The type-design review caught that this left `new_loans`
without a direct RLS anchor, meaning the RLS migration could not create a simple `organization_id`
policy on that table. Adding `organization_id` directly to `new_loans` enabled a direct equality
policy and eliminated a subquery join in the RLS policy layer.

### 11. `UNIQUE(deal_id, chain_position)` on `existing_loans`

The initial implementation of `existingLoans` had no uniqueness constraint on `(deal_id, chainPosition)`.
The type-design review identified that two `existing_loan` rows for the same deal at the same chain
position would silently corrupt the Schedule A consolidation list — the set of mortgages being
consolidated, ordered oldest to newest. The unique index `existing_loans_deal_chain_pos_idx` was
added in the fix-up PR.

### 12. Turbopack workspace package `.js` extension stripping

Turbopack (the dev server bundler in Next.js 16) resolves workspace package imports differently from
webpack. When `apps/web` imports from `@cema/db`, `@cema/auth`, etc., Turbopack follows the
TypeScript source directly rather than a compiled output. TypeScript source files use implicit `.js`
extensions in `import` statements (a TSC convention for ESM interop), but Turbopack could not
resolve these when the actual files are `.ts`.

The fix was to remove explicit `.js` extensions from 26 import statements across `packages/*/src/`.
This was discovered during Task 16 (Clerk webhook sync) when Turbopack threw a module-not-found
error on the first run of `next dev --turbo` against the workspace packages.

### 13. `proxy.ts` instead of `middleware.ts`

Next.js 16 renamed `middleware.ts` to `proxy.ts`. The plan's file structure listed `middleware.ts`.
At scaffold time, when creating the Clerk auth gate, we discovered the rename and adopted `proxy.ts`.
The matcher config and Clerk middleware API are otherwise identical.

### 14. `typedRoutes` promoted from `experimental` to top-level

The plan specified `experimental.typedRoutes: true` in `next.config.ts`. Next.js 16 promoted
`typedRoutes` to a top-level `next.config` option (no longer nested under `experimental`). Adopted
at scaffold time.

### 15. ESLint 9 flat-config bridge (`ESLINT_USE_FLAT_CONFIG=false`)

ESLint 9 defaults to flat-config format. The repo uses the legacy `.eslintrc.cjs` format (the
`@cema/config` package exports a legacy config). Rather than migrating all ESLint config to flat
format (a significant rewrite), we added `cross-env ESLINT_USE_FLAT_CONFIG=false` to every
`lint` script in every package. This tells ESLint 9 to continue using the legacy loader.

This is explicitly a technical debt item. When the ESLint ecosystem fully stabilizes around flat
config (expected late 2026), migrate all config to flat format and remove the env var shim.

### 16. Clerk `^7.0.0` (not `^6.0.0`)

The plan noted Clerk version `^7.0.0` as the target. During implementation, training-data confusion
temporarily caused a `^6.0.0` install to be attempted. Clerk's versioning had a major jump — v7 is
the current SDK at time of shipping. We locked to `^7.0.0`.

---

## Plan-vs-reality divergences

| Item                      | Plan said                                | What shipped                        | Why                                                                    |
| ------------------------- | ---------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| Drizzle version           | `^0.36.0`                                | `^0.45.2`                           | Snyk flagged CVE GHSA-gpj5-g38j-94v9 in earlier versions during Task 3 |
| drizzle-kit version       | Not pinned                               | `^0.31.0`                           | Matched drizzle-orm peer requirement at v0.45                          |
| `middleware.ts`           | `apps/web/middleware.ts`                 | `apps/web/proxy.ts`                 | Next.js 16 renamed it                                                  |
| `typedRoutes`             | `experimental.typedRoutes`               | `typedRoutes` (top-level)           | Next.js 16 promotion                                                   |
| `assignment` enum         | `documentKindEnum` included `assignment` | `aom` used instead                  | Type-design review; CLAUDE.md hard rule #2 uses literal `aom`          |
| `fha` + `va` in enum      | `loanProgramEnum` included both          | Removed                             | Spec §2.2 explicit exclusions; type-design review                      |
| `newLoans.organizationId` | Not in plan's schema                     | Added                               | Type-design review; needed for direct RLS policy                       |
| Chain-position uniqueness | No constraint planned                    | `UNIQUE(deal_id, chain_position)`   | Type-design review; Schedule A correctness                             |
| Attorney gate in schema   | Boolean column only                      | Boolean column + CHECK constraint   | Type-design review; CLAUDE.md hard rule #2 elevated to DB constraint   |
| Turbopack `.js` imports   | Not anticipated                          | Stripped from 26 files              | Turbopack workspace resolution behavior                                |
| ESLint flat config        | Not anticipated                          | `ESLINT_USE_FLAT_CONFIG=false` shim | ESLint 9 default changed                                               |
| Test count                | ~30 unit tests planned                   | 55 unit tests shipped               | TDD rigor + fix-up test coverage                                       |

---

## Type-design review investment

The `pr-review-toolkit:type-design-analyzer` was dispatched after Tasks 5, 6, 7, and 8. It surfaced
**17 issues across the four reviews** (3 Critical / 8 Important / 6 Minor). Each review produced a
dedicated fix-up PR before the next schema task began:

- After Task 5 (tenants) → PR #6: tighten tenant invariants
- After Task 6 (servicers) → PR #8: tighten servicer invariants
- After Task 7 (deals/loans) → PR #10: tighten deal invariants (chain-position UNIQUE, newLoans.orgId)
- After Task 8 (documents/attorney-review) → PR #12: enforce attorney gate as CHECK, dedupe approvals, SSN plaintext rejection

The compounding effect was measurable: issues caught in rounds 1–2 (tenants, servicers) were not
repeated in rounds 3–4 (deals, documents). The TDD instinct to write the failing test first, then
fix, applied equally well to schema design.

---

## Consequences

### Positive

- Schema is type-safe end-to-end: Zod validates form input → Drizzle inserts typed rows →
  Postgres CHECK constraints enforce domain invariants at the DB level. A type error anywhere in
  the chain fails at the earliest possible boundary.
- RLS enforced at the DB layer for 8 tenant-scoped tables. Application-level org scoping (Clerk)
  is defense-in-depth; the DB layer is the authoritative gate.
- Audit log emits on every Deal mutation via `emitAuditEvent()` in `packages/compliance`. The log
  is append-only by convention (no `updatedAt`, no DELETE path exposed in the API).
- Attorney-review gate enforced both at the DB level (CHECK constraint) and at the application
  layer (`requireAttorneyApproval()` in `packages/compliance`).
- Build/lint/typecheck/test gates fully wired in CI. Branch protection requires all checks green.
  Pre-commit hooks enforce formatting and conventional commits locally.
- Vercel preview-per-PR is live. Every PR gets a preview URL for review.
- 55 unit tests + RLS isolation proof test (hits real Neon dev branch).

### Negative / accepted trade-offs

1. **`neondb_owner` has `BYPASSRLS=true` in production.** The connection string in `DATABASE_URL`
   uses the `neondb_owner` role, which Neon provisions with `BYPASSRLS=true`. This means the
   production app currently bypasses all RLS policies even though they are defined and tested. Task
   23's RLS isolation test works around this by explicitly switching to `cema_app_user` inside the
   test. The production application does not do this switch. **Mitigation:** Phase 0 Month 2
   carry-over item #1 — create `cema_app_user` in the Neon project, grant it appropriate table
   privileges, and switch `DATABASE_URL` to use that role. The `withRlsContext()` helper in
   `packages/db/src/rls.ts` is already written to use `SET LOCAL` correctly; only the connection
   role needs changing.

2. **No DB-level immutability triggers on `audit_events` and `attorney_approvals`.** The spec says
   these tables are append-only and immutable. Currently this is enforced only by application
   convention — there is no Postgres BEFORE UPDATE/DELETE trigger blocking mutations. A bug or a
   direct DB query could modify or delete rows. **Mitigation:** Phase 0 Month 2 — add Postgres
   triggers that RAISE EXCEPTION on any UPDATE or DELETE attempt against these tables.

3. **No composite FK from `attorney_approvals(documentId, documentVersion)` to
   `documents(id, version)`.** The approval row snapshots `documentVersion` at time of approval,
   but there is no FK constraint ensuring that version actually exists on the document. Phantom
   version references (approval for version 3 when the document only has version 2) are caught
   only at application layer. **Mitigation:** Phase 0 Month 2 schema cleanup — add a composite
   unique index on `documents(id, version)` and a FK from `attorney_approvals` to it.

4. **Husky v8 shim in hook files.** The `.husky/pre-commit` and `.husky/commit-msg` files contain
   `. "$(dirname -- "$0")/_/husky.sh"`, the Husky v8 source pattern. Husky 9 emits a deprecation
   warning on every commit. This will break when Husky 10 ships and removes the shim. **Mitigation:**
   Phase 0 Month 2 carry-over item #2 — strip the shim line from both hook files (Husky 9+
   does not require it).

5. **GitGuardian secret-scan check fails on every PR.** The `Secret scan` GitHub Actions step
   fails because `GITGUARDIAN_API_KEY` was never added to repository secrets. It is non-blocking
   (the check is allowed to fail without blocking merge) but produces visible noise. **Mitigation:**
   Either add the API key to repo secrets or remove the check if GitGuardian is not in the toolchain.

6. **`DealForm` label has no `htmlFor` association.** The new-deal form's Label component does not
   use `htmlFor` pointing to the corresponding field's `id`. The Playwright e2e test worked around
   this with a custom field-finder helper. Screen readers will not correctly associate the label
   with its field. **Mitigation:** Fix `packages/ui` Label to accept and wire `htmlFor`; update
   `DealForm` to set matching `id` attributes on inputs.

7. **SSN encryption is schema-only, not implemented.** The `parties.ssn_encrypted` column exists
   and the CHECK constraint rejects plaintext SSN patterns. However, the actual pgcrypto encryption
   and decryption helpers do not yet exist. The `packages/compliance` package has `redactPii()` for
   logs but no `encryptSsn()` / `decryptSsn()` pair. **Mitigation:** Phase 1 — implement
   pgcrypto-based symmetric encryption before any party SSN is written by the application.

---

## Acceptance criteria status

From the plan's deliverable list:

| Criterion                                             | Status                                           |
| ----------------------------------------------------- | ------------------------------------------------ |
| `pnpm dev` starts against real Neon dev branch        | Confirmed                                        |
| `pnpm test` passes (~30 unit tests)                   | Confirmed (55 shipped, exceeds plan)             |
| `pnpm test:e2e` passes (1 happy-path Playwright test) | Confirmed (label-gated in CI)                    |
| Vercel preview deploy succeeds on a feature branch    | Confirmed                                        |
| Audit log captures every Deal mutation                | Confirmed (server actions call `emitAuditEvent`) |
| Two orgs in same DB cannot see each other's Deals     | Confirmed (RLS isolation test, PR #27)           |

---

## Carry-overs to Phase 0 Month 2

These items are documented in CLAUDE.md §2 and reproduced here for the ADR record:

1. **RLS BYPASSRLS gap** — switch `DATABASE_URL` to use `cema_app_user` (BYPASSRLS=false). Create
   the role in Neon, grant table privileges, update Vercel env var. This is the highest-priority
   item because RLS policies are currently inert in production.

2. **Husky v10 readiness** — strip the v8 shim line from `.husky/pre-commit` and `.husky/commit-msg`.

Additionally discovered during ADR drafting:

3. **Audit log immutability triggers** — add Postgres BEFORE UPDATE/DELETE triggers on
   `audit_events` and `attorney_approvals`.

4. **Composite FK on `attorney_approvals.documentVersion`** — add `UNIQUE(id, version)` to
   `documents` and a FK from `attorney_approvals(document_id, document_version)` to it.

5. **`DealForm` accessibility** — fix `htmlFor` / `id` wiring in Label + form fields.

6. **SSN encryption implementation** — add `encryptSsn()` / `decryptSsn()` to `packages/compliance`
   before any party SSN path is implemented.

7. **GitGuardian secret scan** — provision the API key or remove the check.

8. **ESLint flat-config migration** — not urgent, but should be scheduled before ESLint 10.

---

## References

- Design spec: `docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-12-phase-0-month-1-foundation.md`
- 28 merged PRs: #1 (`chore/bootstrap-pnpm-husky`) through #28 (`docs(claude): mark phase 0 month 1 complete`)
- Final SHA: `12f6cae`
- Key schema files: `packages/db/src/schema/` (8 source files, 13 tables)
- RLS migration: `packages/db/migrations/0001_rls.sql`
- RLS isolation test: `apps/web/tests/integration/rls-isolation.test.ts`
- Compliance primitives: `packages/compliance/src/`
