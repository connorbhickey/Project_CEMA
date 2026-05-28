# CLAUDE.md — Project_CEMA

> **Read this file first.** It is the operating manual for any AI assistant working in this repo. Treat it as authoritative on conventions, constraints, and where to look. The design spec is the authoritative source on _what_ we're building; this file is the authoritative source on _how_ we work.

---

## 1. Project identity

**Project_CEMA** is a vertical AI software product that replaces the labor of 2–3 CEMA (Consolidation, Extension, and Modification Agreement) mortgage loan processors at NY-active lender clients. It is a four-layer system: Deal entity + attorney review (Layer 1), unified processor workspace (Layer 2), CEMA AI agents (Layer 3), and an autonomous voice agent (Layer 4).

- **Buyer:** NY-active lender (all four sub-types: IMB, regional bank, community bank/credit union, wholesale).
- **Geographic scope:** New York State only at launch. Co-ops, VA loans, FHA loans, and other states are out of scope.
- **Compliance posture:** Attorney-supervised lender tool. Every legal document carries a required attorney-review gate before borrower release.
- **Spec:** [docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md](docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md) — read this before writing significant code.
- **Research:** [docs/research/01-job-tasks-and-automation.md](docs/research/01-job-tasks-and-automation.md), [docs/research/02-competitive-landscape.md](docs/research/02-competitive-landscape.md) — domain context.

---

## 2. Current status (update as we progress)

- **Phase:** **Phase 0 (Layers 1–2 foundation) fully closed at Month 9 (2026-05-24, on `feat/m9-cache-hardening-activity-feed`); Phase 1 (Layer 3 — CEMA AI agents) begins at Month 10, next.** (Roadmap reconcile 2026-05-28: spec §11 scheduled the agent layer for Months 6–9, but M6–M9 instead deepened the Layer 2 foundation — KG, search, memory, entity resolution, cache — so the agent layer starts ~4 months after the spec roadmap. M10's first agent is the **Intake Agent**; plan at `docs/superpowers/plans/2026-05-28-phase-1-month-10-intake-agent.md`. Spec §11 still shows the original schedule — a re-baseline diff awaits Connor's approval per hard-rule #11.) M9 shipped five subsystems: new `@cema/cache` package (Upstash Redis client + sliding-window rate limiter, env-gated via `isUpstashConfigured()`); `apps/web/proxy.ts` (Clerk auth + env-gated rate limit on `/api/webhooks/*`, fail-open on Redis error — Next.js 16 renamed `middleware.ts` to `proxy.ts`); Twilio webhook SETNX idempotency with del-on-failure cleanup (24h TTL on `RecordingSid`, M2 carry-over §8.5); recording retention cron with CRON_SECRET auth + per-row audit events (`/api/cron/recording-retention`, monthly `0 3 1 * *`, soft-delete via `deleted_at` + zero blob URLs, `BATCH_SIZE=500`); deal activity feed (`/deals/[id]/activity` RSC page + `getDealActivity` query unioning communications + documents, sorted desc by occurredAt). 0 new migrations (code-only month). 480 tests passing across 21 packages. See `docs/adr/0009-phase-0-month-9-cache-hardening-activity-feed.md`.
- **Previously closed (M8):** Telephony entity resolution shipped via PR #62 (`feat/m8-telephony-entity-resolution`, merged 2026-05-26 with admin-bypass after exhaustive CR review). Three subsystems: `comms.embed` publish from Twilio recording-complete callback; `contact_identities` seeding in `linkContactToParty` (email + phone normalized, with `party.linked` audit event); phone entity resolution in `resolveCommParties` (`kind='phone'` lookup). See `docs/adr/0008-phase-0-month-8-telephony-entity-resolution.md`.
- **Next step:** Execute **Phase 1 Month 10 — Intake Agent** (plan: `docs/superpowers/plans/2026-05-28-phase-1-month-10-intake-agent.md`; first Layer 3 agent — deterministic eligibility + recording-tax savings core behind a `LosAdapter`, with the WDK wrap deferred since `@vercel/workflow` is not yet installed). **Gating prerequisites for Connor:** (1) provision `TYPESENSE_API_KEY`, `TYPESENSE_HOST`, `MEM0_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `CRON_SECRET` in Vercel to activate the dormant M6/M7/M9 integrations — the runbook now covers all six: `docs/runbooks/m7-env-var-provisioning.md`; (2) secure a design partner (spec §13.1 — highest risk, overdue, now on the critical path for validating any agent end-to-end); (3) confirm the NY recording-tax rate table the Intake Agent's savings math depends on (plan §6).
- **CI health (2026-05-28):** `main` is green again after a maintenance pass. The M9 admin-bypass was caused by a Prettier `format:check` failure on `CLAUDE.md` — the `Lint` job runs `pnpm format:check` over **all** `*.md`, not just code, and lint-staged only formats _staged_ files. Fixed by reformatting. The nightly **E2E (Playwright)** workflow had been failing since creation: `pnpm exec playwright install` ran from the repo root, where the `@playwright/test` binary (it lives in `apps/web`) isn't on `PATH` (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`). Fixed with `pnpm --filter web exec` + a `webServer` gate on `E2E_USER_EMAIL` so credential-less nightlies skip-green.
- **Phase 0 Month 9 carry-overs to M10+ (8 items — see ADR 0009 for full list):**
  1. **Upstash provisioning:** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` env vars needed in Vercel.
  2. **Extend SETNX idempotency to Nylas, Slack, Drive, DocuSign, Deepgram webhooks** (each has its own natural idempotency key).
  3. **Blob cleanup job:** scan `recordings WHERE deleted_at < now() - interval '30 days'` and call Vercel Blob `del()`.
  4. **Activity feed pagination + cursor:** current 200-row cap per source will exceed itself on long-running deals.
  5. **`kg_edges` → deal attribution:** add `deal_id` column + backfill, then re-add edges to `getDealActivity`.
  6. **Activity feed filters:** "show only emails", "show only documents", etc.
  7. **Typesense + Mem0 provisioning (still pending from M7).**
  8. **All M2–M8 carry-overs still pending.**
- **Phase 0 Month 7 carry-overs to M8+ (5 items — see ADR 0007 for full list):**
  1. **Typesense Cloud provisioning:** `TYPESENSE_API_KEY`, `TYPESENSE_HOST` env vars needed in Vercel. `isTypesenseConfigured()` gates all calls until then.
  2. **Mem0 live provisioning:** `MEM0_API_KEY` env var needed in Vercel. `isMemoryConfigured()` gates all calls until then.
  3. **Vercel env var sync + production smoke test:** After Typesense + Mem0 API keys provisioned per runbook.
  4. **All M2–M7 carry-overs still pending** (see below).
- **Phase 0 Month 4 carry-overs to M9+ (14 items — see ADR 0004 for full list):**
  1. **Teams messaging:** Requires Azure app registration. Mirrors Slack tasks.
  2. **OneDrive / Box / Dropbox / Egnyte / NetDocs / iManage:** All require vendor accounts. File integration breadth is Phase 1.
  3. **Adobe Sign / PandaDoc / Snapdocs / Pavaso / Stavvy:** Secondary eSign + RON vendors. Phase 2.
  4. **Reducto IDP:** Turns Drive blobs + email attachments into classified `documents` rows. Phase 1.
  5. **ClamAV malware scan:** Phase 1 security hardening.
  6. **CRM Merge.dev pulls + enrichment (Clay/Apollo/ZoomInfo):** Contact enrichment from external sources. Phase 1.
  7. **ML similarity for contact dedup:** pgvector name/address dedup. Phase 1 per spec §9.1.
  8. **WDK consumers for Slack / Drive / DocuSign topics:** Phase 1 durable workflows.
  9. **Settings OAuth UIs (Slack, Drive, DocuSign):** Depends on Nango provider configs + vendor app registrations.
  10. **Drive push notification replay protection:** Upstash SETNX (Phase 1 security hardening).
  11. **`contact_identities` org integrity constraint:** Phase 1.
  12. **Drive Blob retention policy:** Phase 1.
  13. **Communication ↔ Party resolution — RESOLVED in M8.** All channels (email, Slack, phone) now wired: `comms.embed` publishes from Twilio webhook; `contact_identities` seeded at `linkContactToParty`; `resolveCommParties` extended with `kind='phone'` lookup.
  14. **All M2–M3 carry-overs still pending** (Nango + PBX vendors; WDK telephony workflow; Upstash telephony idempotency; Nylas OAuth app; Cal.com; NeverBounce; recording retention cron).
- **Phase 0 Month 3 carry-overs (8 tasks — 7 carried to M9, 1 resolved in M8):**
  1. **Tasks A–B (Nylas app + Google/Microsoft OAuth + Nango config):** Requires OAuth app registration in 3 vendor portals.
  2. **Task C (`/settings/integrations/email-calendar` UI):** Depends on Nango OAuth flow being live.
  3. **Task D (Reducto IDP for email attachment classification):** Phase 1.
  4. **Task E (Cal.com scheduling links):** Out of scope until scheduling agent ships.
  5. **Task F (NeverBounce outbound email verification):** Phase 1+.
  6. **Task G (WDK workflow for async email enrichment):** Phase 1.
  7. **Task H (Vercel env var sync + production smoke test):** Requires real `NYLAS_API_KEY` + `NYLAS_WEBHOOK_SECRET`.
  8. **Communication ↔ Party resolution — RESOLVED in M8.** Telephony `from_party_id`/`to_party_ids` now wired via `kind='phone'` identity lookup.
- **Phase 0 Month 2 carry-overs (12 tasks — 11 carried to M9, 1 resolved in M8):**
  1. **Tasks 10–14 (Nango + RingCentral / Dialpad / Zoom Phone):** Requires OAuth app creation in vendor portals.
  2. **Tasks 20–22 (WDK workflow + queue consumer + telephony settings UI):** `@vercel/workflow` not installed.
  3. **Task 26 (E2E webhook→DB integration test):** Depends on Tasks 11-12 + 20-21.
  4. **Task 28 (Vercel env var sync + production smoke test):** Requires real API keys.
  5. **Upstash idempotency:** Add `SETNX telephony:idempo:<vendor_event_id>` in webhook handlers (spec §8.5).
  6. **Communication ↔ Party resolution — RESOLVED in M8.** Telephony `from_party_id`/`to_party_ids` now resolved via `kind='phone'` identity lookup in `resolveCommParties`.
  7. **Recording retention cron:** Phase 1 or M9.
- **Phase 0 Month 1 carry-overs — all 9 RESOLVED** (RLS production enforcement, Husky v10, Vercel preview-quota, audit-log immutability triggers, doc-version composite FK, DealForm a11y, SSN pgcrypto helpers, GitGuardian soft-fail, CI repairs). Detail in ADR-0001 + PRs #30–#35. Two live follow-ups remain: provision the real `GITGUARDIAN_API_KEY` (currently soft-fail via `continue-on-error`) and re-enable `bundle-size` in Phase 1 (currently disabled pending size-limit config).
- **New autonomous-PR posture (2026-05-21):**
  - Branch protection `main`: required checks unchanged (Lint, Typecheck, Unit tests, Build), `required_approving_review_count` lowered from `1` → `0` (solo-dev).
  - CodeRabbit GitHub App installed on `connorbhickey` org (Open Source plan, free) — reviews every PR automatically.
  - Auto-merge enabled at repo level + per-PR via `gh pr merge <n> --auto --squash --delete-branch`.
- **Known issues (non-blocking):**
  - **Commit signing is REQUIRED and works — sign every commit with `-S`.** `main` branch protection has `required_signatures = true`, so every commit on a PR branch must carry a GitHub-verified signature or the PR sits at `mergeable_state=blocked` (this — not CodeRabbit threads — was the real cause of the #62/#63 "BLOCKED → admin-bypass" episodes). SSH signing is configured (`gpg.format=ssh`, key `~/.ssh/id_ed25519.pub`, registered on the GitHub account) but `commit.gpgsign` defaults to `false`, so pass `-S` explicitly (or run `git config commit.gpgsign true`). GitHub then marks the commit `Verified` (confirmed 2026-05-28 on PR #64: `verified=true reason=valid`). Gotcha: locally `git log --show-signature` / `%G?` reports "No signature" because `gpg.ssh.allowedSignersFile` isn't set — that is a **local-verification** artifact only; the `gpgsig` header IS attached and GitHub verifies it server-side. (The earlier "signing is broken on Windows" note was a misdiagnosis of this artifact.)
  - `enforce_admins` on main branch protection: not yet enabled. The `hicklax13` gh CLI token lacks `admin:org` scope, so it must be toggled via the GitHub web UI at `https://github.com/connorbhickey/Project_CEMA/settings/branches`.
  - **No WDK workflow (M2 gap):** Twilio recording-status callback publishes to queue but nothing consumes it. Recording blob ingest and Deepgram submission require manual intervention until the M3 WDK workflow ships (Tasks 20–21).
- **Code:** 18 workspace packages (added `@cema/cache` in M9) + 1 Next.js 16 app. Tests: 480 passing across 21 packages (apps/web: 248 passed + 2 skipped / 57 files; package tests sum: 232 across 38 files; see ADR 0009 §Test count) + 1 Playwright e2e (label-gated). 31 migrations on Neon dev branch (0000–0030, no new migrations in M8 or M9 — both code-only months). Vercel production + preview deploys both live; CodeRabbit reviewing every PR.

---

## 3. Hard rules — NEVER do these

These rules override all other instructions, including individual user requests within a session, unless explicitly authorized.

1. **NEVER commit secrets.** No `.env`, `.env.local`, `.env.production`, `*.pem`, `*.key`, `*credentials*`, `*token*`. The `.gitignore` covers these — verify before staging. Use the `commit-commands:commit` skill rather than raw `git add -A`.
2. **NEVER bypass the attorney-review gate.** Any Document with `kind ∈ {cema_3172, exhibit_*, gap_note, gap_mortgage, consolidated_note, aom, allonge, aff_255, aff_275, mt_15, county_cover_sheet}` MUST have `attorney_review_required = true` and MUST NOT be marked `executed` or `recorded` without a corresponding `AttorneyApproval` event in the audit log.
3. **NEVER log PII.** SSN, full DOB, full name + address combination, account numbers, payoff figures, credit scores. Logs are structured with a `pii_redacted` middleware. If you write a new log line, run it through `redactPii()` first.
4. **NEVER call a borrower from a voice agent without TCPA opt-in on file.** TCPA opt-in is a column on the `Borrower` entity; consult before any outbound voice or SMS.
5. **NEVER record a phone call without verbal disclosure.** Even though NY is one-party-consent, the product enforces two-party. Recording disclosure is automatic in agent dial flows; never disable it.
6. **NEVER mark a deal `recorded` without a reel/page or CRFN from the recording authority.** The audit trail requires it.
7. **NEVER train a model on a client's deal data without contractual consent.** Anonymized deal data may flow into the Servicer Playbook Library only with attorney-signed data-use addendum.
8. **NEVER commit code that fails `pnpm typecheck`, `pnpm lint`, or `pnpm test`.** Pre-commit hooks block this. If a hook blocks you, fix the underlying issue — do not use `--no-verify`.
9. **NEVER amend a pushed commit on `main`.** Create a new commit.
10. **NEVER force-push to `main`.** Branch protection blocks this, but the rule is also social — protect history.
11. **NEVER write to `docs/superpowers/specs/*.md` to "fix" something mid-implementation.** The spec is the source of truth. If reality diverges from spec, raise it as a question; if approved, update the spec via a separate PR with the user (Connor) as approver.
12. **NEVER add a new external integration without an entry in `packages/integrations/<name>` and a row in the spec's §16 Integration Catalog.** Drive-by integrations sprawl and become unmaintainable.

---

## 4. Tech stack (single source of truth)

| Layer                             | Choice                                                         | Why                                                |
| --------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| **Framework**                     | Next.js 16 (App Router, RSC, Cache Components, PPR, Turbopack) | RSC for data-dense pages; Server Actions for forms |
| **Language**                      | TypeScript (strict mode)                                       | Per global CLAUDE.md                               |
| **UI**                            | Tailwind CSS + shadcn/ui + AI Elements                         | Production design system + AI surfaces             |
| **Forms**                         | react-hook-form + Zod + @hookform/resolvers/zod                | Type-safe end-to-end                               |
| **Client state**                  | TanStack Query (where RSC isn't enough)                        | Battle-tested                                      |
| **Database**                      | Neon Postgres (serverless, branch-per-PR)                      | Vercel Marketplace native                          |
| **ORM**                           | Drizzle                                                        | Type-safe; serverless-friendly                     |
| **Vector**                        | pgvector (in-DB) + Turbopuffer (scale)                         | pgvector for per-tenant; Turbopuffer for global    |
| **Graph**                         | Apache AGE extension on Postgres                               | Avoid Neo4j ops                                    |
| **Blob**                          | Vercel Blob                                                    | Native to Vercel                                   |
| **Cache**                         | Upstash Redis                                                  | Marketplace, serverless                            |
| **Queue**                         | Vercel Queues                                                  | Native event bus                                   |
| **Durable workflows**             | Vercel Workflow DevKit (WDK) primary + Inngest fallback        | 75-day CEMA lifecycle requires durability          |
| **Cron**                          | Vercel Cron Jobs                                               | Chase reminders, SLA detection                     |
| **Sandbox**                       | Vercel Sandbox                                                 | Untrusted code (PDF render, browser automation)    |
| **LLM router**                    | Vercel AI Gateway                                              | Multi-provider, cost tracking, failover            |
| **LLM (primary)**                 | Anthropic Claude Opus 4.7 (`claude-opus-4-7`)                  | Best agentic tool-use, long context                |
| **LLM (workhorse)**               | Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`)              | 80% of routine tasks                               |
| **LLM (structured / multimodal)** | OpenAI GPT-5                                                   | Strict JSON, image understanding                   |
| **LLM (long context)**            | Google Gemini 2.5 Pro                                          | When > 200k tokens                                 |
| **STT**                           | Deepgram Nova-3 (real-time) + Whisper Large v3 (batch)         | Best price/perf for telephony                      |
| **TTS**                           | ElevenLabs Conversational AI (Phase 3)                         | Best naturalness                                   |
| **Embeddings**                    | OpenAI text-embedding-3-large (3072-dim)                       | Standard                                           |
| **Memory**                        | Mem0                                                           | Agent-level memory                                 |
| **IDP**                           | Reducto + AWS Textract Lending + Vaultedge                     | Tiered                                             |
| **Auth**                          | Clerk + WorkOS (enterprise SSO)                                | Vercel Marketplace native                          |
| **Multi-tenancy**                 | Postgres RLS + Drizzle policies                                | Defense in depth                                   |
| **Telephony (agent)**             | Twilio Voice primary + Telnyx fallback                         | STIR/SHAKEN, recording                             |
| **Email / calendar unified**      | Nylas                                                          | One API for Gmail + Microsoft Graph                |
| **OAuth integration broker**      | Nango                                                          | Manages 50+ OAuth flows                            |
| **CRM unified**                   | Merge.dev                                                      | Salesforce + HubSpot + more                        |
| **eSign**                         | DocuSign primary + Pavaso (RON)                                | Mortgage industry standard                         |
| **Email outbound**                | Resend                                                         | DX + deliverability                                |
| **SMS**                           | Twilio                                                         | TCPA-compliant footprint                           |
| **Observability (app)**           | Sentry + Vercel Observability + OpenTelemetry                  | Errors + traces + RUM                              |
| **Observability (LLM)**           | Braintrust                                                     | Evals + traces                                     |
| **Product analytics**             | PostHog                                                        | Single tool: analytics + flags + replay            |
| **Feature flags**                 | Vercel Flags SDK (PostHog provider)                            | Native                                             |
| **Notifications**                 | Knock                                                          | Multi-channel prefs                                |
| **B2B billing**                   | Stripe Billing + Metronome                                     | Per-deal usage + per-seat                          |
| **Compliance automation**         | Vanta                                                          | SOC 2                                              |
| **Support**                       | Plain                                                          | B2B-native ticketing                               |
| **CI/CD + hosting**               | Vercel                                                         | Preview-per-PR, prod promote                       |
| **Source control**                | GitHub (`connorbhickey/Project_CEMA`)                          | Per global CLAUDE.md                               |
| **Monorepo**                      | Turborepo + pnpm                                               | Task graph + workspace                             |

If you need to deviate from the above, surface it explicitly — do not silently introduce a competing tool.

---

## 5. Architecture in 60 seconds

```
Layer 4  →  Autonomous Voice Agent       (Phase 3)
Layer 3  →  CEMA AI Agents               (Phases 1–2)
Layer 2  →  Unified Processor Workspace  (Phase 0) ⭐ the foundation
Layer 1  →  Deal Entity + Attorney Gate  (Phase 0)
```

- **Deal** is the central entity. Every screen, agent, and document is a view over a Deal.
- **Servicer** is the moat-bearing entity. Per-servicer playbooks accumulate over time.
- **Communication** is everything captured in Layer 2 — calls, emails, IMs, calendar events. All linked to a Deal (eventually).
- **Document** is every PDF/file the deal touches. IDP-extracted data is stored alongside the blob.
- **AttorneyApproval** is an immutable event that gates document release.

Full data model in [§6 of the spec](docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md).

---

## 6. Repository structure (planned for Phase 0)

```
Project_CEMA/
├── apps/
│   ├── web/                    # Next.js 16 — the processor & attorney workspace
│   ├── api/                    # Vercel Functions for non-RSC endpoints
│   └── admin/                  # Internal admin (servicer playbook editor, tenant mgmt)
├── packages/
│   ├── agents/                 # Layer 3 AI agents (WDK workflows)
│   ├── idp/                    # Document extraction pipeline
│   ├── doc-gen/                # DocMagic / template-based document generation
│   ├── integrations/           # External integrations (one folder per integration)
│   │   ├── encompass/
│   │   ├── lendingpad/
│   │   ├── qualia/
│   │   ├── docmagic/
│   │   ├── simplifile/
│   │   ├── nylas/              # email + calendar
│   │   ├── ringcentral/
│   │   ├── dialpad/
│   │   ├── zoom-phone/
│   │   ├── teams-phone/
│   │   ├── twilio/
│   │   ├── deepgram/
│   │   ├── elevenlabs/         # Phase 3
│   │   ├── docusign/
│   │   ├── pavaso/
│   │   ├── slack/
│   │   ├── teams/
│   │   ├── drive/
│   │   ├── onedrive/
│   │   ├── box/
│   │   ├── acris/              # NYC ACRIS Open Data + E-Tax automation
│   │   ├── mers/
│   │   ├── nylas-calendar/
│   │   ├── persona/            # KYC
│   │   ├── truework/           # 4506-C
│   │   └── …
│   ├── db/                     # Drizzle schema + migrations
│   ├── auth/                   # Clerk + WorkOS wrappers
│   ├── ui/                     # shadcn/ui components + design system
│   ├── ai-elements/            # AI-specific React components (chat, transcript viewer)
│   ├── prompts/                # Versioned prompts for each agent
│   ├── workflows/              # WDK workflow definitions
│   ├── search/                 # Typesense + pgvector + Turbopuffer wrappers
│   ├── memory/                 # Mem0 wrapper + conversation persistence
│   ├── kg/                     # Apache AGE knowledge graph queries
│   ├── compliance/             # PII redaction, audit log, RLS helpers
│   ├── playbooks/              # Per-servicer playbook entities + tests
│   ├── billing/                # Stripe + Metronome usage events
│   ├── notifications/          # Knock client + templates
│   ├── observability/          # OpenTelemetry + Sentry + Braintrust wrappers
│   ├── feature-flags/          # Vercel Flags wrappers
│   └── config/                 # Shared tsconfig, eslint, prettier
├── infrastructure/
│   ├── vercel.json
│   ├── terraform/              # For non-Vercel resources (Phase 1+)
│   └── github/                 # repo settings as code (where supported)
├── docs/
│   ├── superpowers/specs/      # Design specs (authoritative)
│   ├── research/               # Research reports
│   ├── compliance/             # UPL opinion, SOC 2 evidence, TCPA docs
│   ├── playbooks/              # Servicer playbook prose docs
│   ├── runbooks/               # On-call runbooks
│   └── adr/                    # Architecture Decision Records
├── .github/
│   ├── workflows/              # CI/CD actions per spec §20.7
│   ├── ISSUE_TEMPLATE/
│   ├── CODEOWNERS
│   └── pull_request_template.md
├── .changeset/
├── CLAUDE.md                   # this file
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── CODE_OF_CONDUCT.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.json
├── .editorconfig
├── .nvmrc
├── .gitignore
├── .gitattributes
├── .prettierrc
├── .eslintrc.cjs
├── vercel.json
└── .env.example
```

When the structure exists, update this section if it diverges.

---

## 7. Common commands

All commands assume `cmd /c` prefix on Windows (per global CLAUDE.md), and `pnpm` as the package manager.

### Setup (one-time)

```bash
cmd /c "corepack enable && corepack prepare pnpm@latest --activate"
cmd /c "pnpm install"
cmd /c "pnpm db:setup"          # Drizzle migrations on local Neon branch
cmd /c "pnpm dev"               # Start all apps via Turbo
```

### Per-session

```bash
cmd /c "pnpm dev"               # Dev server (Turbopack)
cmd /c "pnpm build"             # Production build all packages
cmd /c "pnpm test"              # Vitest unit tests
cmd /c "pnpm test:e2e"          # Playwright integration tests
cmd /c "pnpm typecheck"         # tsc --noEmit on all packages
cmd /c "pnpm lint"              # ESLint
cmd /c "pnpm format"            # Prettier write
cmd /c "pnpm db:generate"       # Generate Drizzle migrations from schema
cmd /c "pnpm db:migrate"        # Apply migrations to current branch
cmd /c "pnpm db:studio"         # Open Drizzle Studio
cmd /c "pnpm eval"              # Braintrust agent evals
```

### Deployment

Use the `vercel:deploy` skill — never run `vercel deploy` directly. The skill handles env-var sync, project linking, and preview vs. prod logic.

### Git

Use the `commit-commands:commit` skill or `commit-commands:commit-push-pr` skill — these enforce Conventional Commits and pre-commit hooks. Raw `git commit` is allowed but the skill is safer.

---

## 8. Workflow patterns

### Starting a new feature

1. **Read the spec section** that covers the feature (linked from the issue).
2. **Branch:** `feat/<scope>` from latest `main`.
3. **Plan:** for non-trivial features, write the plan to `docs/plans/<feature>.md` first.
4. **TDD:** invoke `superpowers:test-driven-development`. Write the failing test first.
5. **Implement:** small commits, conventional commits, signed.
6. **Self-review:** invoke `pr-review-toolkit:code-reviewer` before opening PR.
7. **Open PR:** use `commit-commands:commit-push-pr` skill.
8. **Address review:** AI + human reviewers. Don't squash mid-review.
9. **Merge:** auto-merge after green + approval.

### Fixing a bug

1. **Reproduce first.** Invoke `superpowers:systematic-debugging`.
2. Write a failing test that captures the bug.
3. Fix.
4. Confirm test passes.
5. PR as `fix/<scope>`.

### Adding an integration

1. **Verify the integration is in spec §16.** If not, raise it before adding.
2. Create `packages/integrations/<name>/` with: `client.ts`, `types.ts`, `webhook.ts`, `README.md`.
3. Add OAuth config to Nango (or document why we can't use Nango).
4. Add a Braintrust eval for any LLM-using code paths.
5. Document required env vars in `.env.example`.

### Writing an agent

1. Use Vercel Workflow DevKit for the orchestration.
2. Use Vercel AI SDK for LLM calls.
3. Route via Vercel AI Gateway — do not hard-code provider.
4. Prompts live in `packages/prompts/` and are versioned.
5. Every agent has a Braintrust eval with ≥ 20 fixtures.
6. Every agent emits OpenTelemetry traces.
7. Every agent writes to the audit log.

---

## 9. Skills to invoke (proactively)

When working in this repo, invoke these skills _before_ the relevant work, not after. The full strategic catalog with rationale lives in [spec §20.18](docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md); this table is the operational quick-reference.

### 9.1 Process discipline (superpowers plugin) — invoke pervasively

| Situation                               | Invoke                                        |
| --------------------------------------- | --------------------------------------------- |
| Starting any conversation               | `superpowers:using-superpowers` (auto-loaded) |
| Pre-spec — designing a feature          | `superpowers:brainstorming`                   |
| Post-spec — translating spec to tasks   | `superpowers:writing-plans`                   |
| Inline plan execution with checkpoints  | `superpowers:executing-plans`                 |
| Multi-task implementation via subagents | `superpowers:subagent-driven-development`     |
| Multiple independent parallel tasks     | `superpowers:dispatching-parallel-agents`     |
| Isolating a risky implementation        | `superpowers:using-git-worktrees`             |
| Implementing a feature or bugfix        | `superpowers:test-driven-development`         |
| Encountering any bug / failing test     | `superpowers:systematic-debugging`            |
| Verifying before claiming done          | `superpowers:verification-before-completion`  |
| Requesting code review                  | `superpowers:requesting-code-review`          |
| Receiving review feedback               | `superpowers:receiving-code-review`           |
| Wrapping up a development branch        | `superpowers:finishing-a-development-branch`  |
| Authoring new skills                    | `superpowers:writing-skills`                  |

### 9.2 Vercel platform skills — invoke for any change touching the relevant area

| Situation                                             | Invoke                                       |
| ----------------------------------------------------- | -------------------------------------------- |
| Any change in `apps/web` (Next.js)                    | `vercel:nextjs`                              |
| React component changes                               | `vercel:react-best-practices`                |
| Long-running / multi-day workflow code                | `vercel:workflow`                            |
| Calling LLMs via AI SDK                               | `vercel:ai-sdk`                              |
| Building AI chat / agent surfaces                     | `vercel:ai-elements`                         |
| Chat-style multi-platform bots                        | `vercel:chat-sdk`                            |
| JSON rendering in chat (tool calls, streaming)        | `vercel:json-render`                         |
| Vercel storage (Neon, Blob, Edge Config, Marketplace) | `vercel:vercel-storage`                      |
| Auth (Clerk / WorkOS)                                 | `vercel:auth`                                |
| Cron tasks                                            | `vercel:cron-jobs`                           |
| Runtime cache                                         | `vercel:runtime-cache`                       |
| Next.js 16 Cache Components / PPR / `use cache`       | `vercel:next-cache-components`               |
| Middleware (routing, rewrites, redirects)             | `vercel:routing-middleware`                  |
| Vercel Sandbox (untrusted code execution)             | `vercel:vercel-sandbox`                      |
| Vercel Functions guidance                             | `vercel:vercel-functions`                    |
| Vercel Queues                                         | `vercel:vercel-queues`                       |
| Vercel feature flags                                  | `vercel:vercel-flags`                        |
| Observability (logs, traces, web analytics)           | `vercel:observability`                       |
| Deploying / promoting / rolling back                  | `vercel:deployments-cicd` or `vercel:deploy` |
| Managing env vars                                     | `vercel:env-vars` or `vercel:env`            |
| Vercel CLI operations                                 | `vercel:vercel-cli`                          |
| Vercel REST API operations                            | `vercel:vercel-api`                          |
| Vercel Agent (PR review, incident investigation)      | `vercel:vercel-agent`                        |
| AI Gateway (model routing, failover)                  | `vercel:ai-gateway`                          |
| Marketplace integrations                              | `vercel:marketplace`                         |
| Turbopack tuning                                      | `vercel:turbopack`                           |
| Turborepo configuration                               | `vercel:turborepo`                           |
| shadcn/ui CLI + registries                            | `vercel:shadcn`                              |
| v0.dev usage                                          | `vercel:v0-dev`                              |
| Next.js version upgrade                               | `vercel:next-upgrade`                        |
| Multiple services in one project                      | `vercel:vercel-services`                     |
| Verifying full-story end-to-end                       | `vercel:verification`                        |
| Browser automation CLI                                | `vercel:agent-browser`                       |
| Browser verification after dev server starts          | `vercel:agent-browser-verify`                |
| Stuck / hung / frustrated                             | `vercel:investigation-mode`                  |
| Knowledge update (correct outdated info)              | `vercel:knowledge-update` (auto-loaded)      |
| Project bootstrap                                     | `vercel:bootstrap`                           |

### 9.3 Engineering plugin — operational rigor

| Situation                          | Invoke                          |
| ---------------------------------- | ------------------------------- |
| Choosing a technology (ADR)        | `engineering:architecture`      |
| Designing a new system / subsystem | `engineering:system-design`     |
| Designing test strategy            | `engineering:testing-strategy`  |
| Self-review before opening PR      | `engineering:code-review`       |
| Structured debugging session       | `engineering:debug`             |
| Writing READMEs / runbooks / docs  | `engineering:documentation`     |
| Tech-debt audit                    | `engineering:tech-debt`         |
| Production incident triage         | `engineering:incident-response` |
| Pre-deploy checklist               | `engineering:deploy-checklist`  |
| Daily / weekly standup write-up    | `engineering:standup`           |

### 9.4 Code review plugins (free AI reviewers)

| Situation                                    | Invoke                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| Comprehensive PR review                      | `pr-review-toolkit:review-pr`                                                     |
| CodeRabbit-driven review                     | `coderabbit:code-review`                                                          |
| Ad-hoc free-standing review                  | `code-review:code-review`                                                         |
| Review focused on security / silent failures | dispatch `pr-review-toolkit:silent-failure-hunter`                                |
| Review of new types/schemas                  | dispatch `pr-review-toolkit:type-design-analyzer`                                 |
| Review of test coverage on a PR              | dispatch `pr-review-toolkit:pr-test-analyzer`                                     |
| Review of comment accuracy                   | dispatch `pr-review-toolkit:comment-analyzer`                                     |
| Simplification pass after a logical chunk    | dispatch `pr-review-toolkit:code-simplifier` or `code-simplifier:code-simplifier` |
| Major-step review against the plan           | dispatch `superpowers:code-reviewer`                                              |

### 9.5 Commit / PR flow

| Situation                  | Invoke                           |
| -------------------------- | -------------------------------- |
| Creating a commit          | `commit-commands:commit`         |
| Commit + push + open PR    | `commit-commands:commit-push-pr` |
| Cleaning `[gone]` branches | `commit-commands:clean_gone`     |

### 9.6 Product management

| Situation                                | Invoke                                     |
| ---------------------------------------- | ------------------------------------------ |
| New feature spec                         | `product-management:write-spec`            |
| Idea exploration                         | `product-management:product-brainstorming` |
| Sprint planning                          | `product-management:sprint-planning`       |
| Roadmap update                           | `product-management:roadmap-update`        |
| Metrics review                           | `product-management:metrics-review`        |
| Stakeholder update                       | `product-management:stakeholder-update`    |
| Competitive brief refresh                | `product-management:competitive-brief`     |
| Synthesizing design-partner interviews   | `product-management:synthesize-research`   |
| Quick brainstorm with a thinking partner | `product-management:brainstorm`            |

### 9.7 Operations

| Situation                       | Invoke                            |
| ------------------------------- | --------------------------------- |
| Documenting an SOP / process    | `operations:process-doc`          |
| Authoring or updating a runbook | `operations:runbook`              |
| Identifying / mitigating risks  | `operations:risk-assessment`      |
| SOC 2 evidence collection       | `operations:compliance-tracking`  |
| Vendor due diligence            | `operations:vendor-review`        |
| Production change request       | `operations:change-request`       |
| Weekly / monthly status report  | `operations:status-report`        |
| Resource capacity planning      | `operations:capacity-plan`        |
| Process optimization analysis   | `operations:process-optimization` |

### 9.8 Legal (mandatory for compliance posture)

| Situation                                                    | Invoke                        |
| ------------------------------------------------------------ | ----------------------------- |
| Any change touching legal documents / borrower comms / audit | `legal:compliance-check`      |
| UPL / TCPA / PII risk assessment                             | `legal:legal-risk-assessment` |
| Triaging an incoming NDA                                     | `legal:triage-nda`            |
| Vendor MSA review                                            | `legal:review-contract`       |
| Status of existing vendor agreement                          | `legal:vendor-check`          |
| E-signature workflow setup                                   | `legal:signature-request`     |
| Pre-counsel meeting preparation                              | `legal:meeting-briefing`      |
| Daily / topic / incident legal briefings                     | `legal:brief`                 |
| Generic legal inquiry response                               | `legal:legal-response`        |

### 9.9 Design + frontend

| Situation                                    | Invoke                            |
| -------------------------------------------- | --------------------------------- |
| Auditing / extending design system           | `design:design-system`            |
| WCAG 2.1 AA accessibility audit              | `design:accessibility-review`     |
| Structured design feedback                   | `design:design-critique`          |
| Writing UX microcopy / errors / empty states | `design:ux-copy`                  |
| Planning user research                       | `design:user-research`            |
| Synthesizing user research                   | `design:research-synthesis`       |
| Generating dev specs from designs            | `design:design-handoff`           |
| Distinctive production-grade UI design       | `frontend-design:frontend-design` |

### 9.10 Data + analytics

| Situation                                  | Invoke                        |
| ------------------------------------------ | ----------------------------- |
| Writing performant SQL                     | `data:sql-queries`            |
| Translating NL to SQL                      | `data:write-query`            |
| Profiling a new dataset                    | `data:explore-data`           |
| Ad-hoc data question                       | `data:analyze`                |
| Pre-share analysis QA                      | `data:validate-data`          |
| Stats methods (trend, outlier, hypothesis) | `data:statistical-analysis`   |
| Building a chart                           | `data:create-viz`             |
| Executive dashboard                        | `data:build-dashboard`        |
| Tribal-knowledge → skill                   | `data:data-context-extractor` |

### 9.11 Anthropic skills (document and artifact handling)

| Situation                                                                 | Invoke                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Any PDF input/output (collateral file, recorded mortgage, NYS-261, MT-15) | `anthropic-skills:pdf` ⭐ core to Phase 1 IDP                         |
| Word doc (.docx) work                                                     | `anthropic-skills:docx`                                               |
| Spreadsheet (.xlsx) work                                                  | `anthropic-skills:xlsx`                                               |
| Slide deck (.pptx) work                                                   | `anthropic-skills:pptx`                                               |
| Building a new MCP server                                                 | `anthropic-skills:mcp-builder`                                        |
| Creating new skills                                                       | `anthropic-skills:skill-creator`                                      |
| Long-form internal doc co-authoring                                       | `anthropic-skills:doc-coauthoring`                                    |
| Multi-component HTML artifact for claude.ai                               | `anthropic-skills:web-artifacts-builder`                              |
| Theming slides / docs / reports                                           | `anthropic-skills:theme-factory`                                      |
| Internal company comms                                                    | `anthropic-skills:internal-comms`                                     |
| Anthropic brand surfaces                                                  | `anthropic-skills:brand-guidelines`                                   |
| Periodic memory audit                                                     | `anthropic-skills:consolidate-memory`                                 |
| Scheduled tasks (beyond Vercel Cron)                                      | `anthropic-skills:schedule`                                           |
| Canvas / algorithmic art for marketing                                    | `anthropic-skills:canvas-design` / `anthropic-skills:algorithmic-art` |

### 9.12 Plugin development (for project-specific extensions)

| Situation                       | Invoke                           |
| ------------------------------- | -------------------------------- |
| Creating a Project_CEMA plugin  | `plugin-dev:create-plugin`       |
| Plugin scaffolding              | `plugin-dev:plugin-structure`    |
| Adding a slash command          | `plugin-dev:command-development` |
| Adding a hook                   | `plugin-dev:hook-development`    |
| Adding a skill                  | `plugin-dev:skill-development`   |
| Adding a subagent               | `plugin-dev:agent-development`   |
| MCP server integration          | `plugin-dev:mcp-integration`     |
| Plugin settings                 | `plugin-dev:plugin-settings`     |
| Alternative skill-creator entry | `skill-creator:skill-creator`    |

### 9.13 Hookify (hook automation)

| Situation                            | Invoke                  |
| ------------------------------------ | ----------------------- |
| Creating hooks from repeat behaviors | `hookify:hookify`       |
| Writing a hook rule                  | `hookify:writing-rules` |
| Enabling / disabling rules           | `hookify:configure`     |
| Auditing active rules                | `hookify:list`          |

Project-specific hooks to author early:

- Pre-commit PII scanner (SSN-pattern blocker)
- Pre-push attorney-review-bypass detector
- Pre-commit audit-log-skip detector

### 9.14 Firecrawl + enterprise search

| Situation                                    | Invoke                                  |
| -------------------------------------------- | --------------------------------------- |
| Scraping public servicer / county clerk docs | `firecrawl:firecrawl-cli`               |
| Auto-generating skills from docs             | `firecrawl:skill-gen`                   |
| Cross-source search                          | `enterprise-search:search`              |
| Daily/weekly cross-source digest             | `enterprise-search:digest`              |
| Synthesized multi-source answers             | `enterprise-search:knowledge-synthesis` |
| Decomposing complex search                   | `enterprise-search:search-strategy`     |
| Connected-source management                  | `enterprise-search:source-management`   |

### 9.15 Marketing + brand voice (post-launch)

| Situation                                 | Invoke                                                               |
| ----------------------------------------- | -------------------------------------------------------------------- |
| Generating brand voice guidelines         | `brand-voice:generate-guidelines`                                    |
| Applying brand voice to content           | `brand-voice:enforce-voice` or `brand-voice:brand-voice-enforcement` |
| Discovering brand assets across platforms | `brand-voice:discover-brand`                                         |
| Refreshing competitive brief              | `marketing:competitive-brief`                                        |
| Multi-channel content draft               | `marketing:content-creation` or `marketing:draft-content`            |
| Campaign planning                         | `marketing:campaign-plan`                                            |
| Customer onboarding email sequence        | `marketing:email-sequence`                                           |
| Marketing-site SEO                        | `marketing:seo-audit`                                                |
| Brand compliance review                   | `marketing:brand-review`                                             |
| Marketing performance review              | `marketing:performance-report`                                       |

### 9.16 Hugging Face (Phase 2+ — fine-tuning)

| Situation                    | Invoke                                           |
| ---------------------------- | ------------------------------------------------ |
| HF CLI operations            | `huggingface-skills:hf-cli`                      |
| NY mortgage dataset curation | `huggingface-skills:hugging-face-datasets`       |
| Fine-tuning a language model | `huggingface-skills:hugging-face-model-trainer`  |
| Fine-tuning a vision model   | `huggingface-skills:hugging-face-vision-trainer` |
| Eval tracking                | `huggingface-skills:hugging-face-evaluation`     |
| Browser ML / Transformers.js | `huggingface-skills:transformers-js`             |
| Internal Gradio demos        | `huggingface-skills:huggingface-gradio`          |
| Experiment tracking          | `huggingface-skills:hugging-face-trackio`        |
| Running HF Jobs              | `huggingface-skills:hugging-face-jobs`           |
| HF tool builder              | `huggingface-skills:hugging-face-tool-builder`   |

### 9.17 Finance (internal accounting / SOX)

| Situation                      | Invoke                                                 |
| ------------------------------ | ------------------------------------------------------ |
| SOC 2 / SOX audit support      | `finance:audit-support`                                |
| Billing reconciliation         | `finance:reconciliation`                               |
| Budget variance analysis       | `finance:variance-analysis`                            |
| Internal financial statements  | `finance:financial-statements`                         |
| Month-end close                | `finance:close-management`                             |
| Journal entries                | `finance:journal-entry` / `finance:journal-entry-prep` |
| SOX sample selection / testing | `finance:sox-testing`                                  |

### 9.18 Productivity

| Situation                   | Invoke                           |
| --------------------------- | -------------------------------- |
| TASKS.md tracking           | `productivity:task-management`   |
| Memory / shorthand decoding | `productivity:memory-management` |
| Refreshing tasks + memory   | `productivity:update`            |
| Initial productivity setup  | `productivity:start`             |

### 9.19 Claude Code self-management

| Situation                            | Invoke                                            |
| ------------------------------------ | ------------------------------------------------- |
| Updating this CLAUDE.md              | `claude-md-management:revise-claude-md`           |
| Auditing this CLAUDE.md              | `claude-md-management:claude-md-improver`         |
| Re-auditing automation opportunities | `claude-code-setup:claude-automation-recommender` |

### 9.20 Figma (if/when design moves to Figma)

| Situation                               | Invoke                                   |
| --------------------------------------- | ---------------------------------------- |
| Before any Figma tool call (MANDATORY)  | `figma:figma-use`                        |
| Translating Figma → production code     | `figma:figma-implement-design`           |
| Generating Figma designs from code/spec | `figma:figma-generate-design`            |
| Building a Figma library from codebase  | `figma:figma-generate-library`           |
| Mapping Figma components to code        | `figma:figma-code-connect-components`    |
| Codifying design rules                  | `figma:figma-create-design-system-rules` |

### 9.21 Other

| Situation                                                 | Invoke                    |
| --------------------------------------------------------- | ------------------------- |
| Interactive parameter exploration / demo                  | `playground:playground`   |
| Guided feature development (alternative to writing-plans) | `feature-dev:feature-dev` |

### 9.22 Subagent types (dispatch via Agent tool)

| Subagent                                  | When to dispatch                            |
| ----------------------------------------- | ------------------------------------------- |
| `Explore`                                 | Codebase exploration > 3 queries            |
| `Plan`                                    | Implementation strategy questions           |
| `general-purpose`                         | Multi-step research with web fetches        |
| `feature-dev:code-architect`              | Architecting new feature within patterns    |
| `feature-dev:code-explorer`               | Deep analysis of existing feature           |
| `feature-dev:code-reviewer`               | High-confidence review filtering            |
| `pr-review-toolkit:code-reviewer`         | PR-time code review                         |
| `pr-review-toolkit:silent-failure-hunter` | After try/catch / fallback changes          |
| `pr-review-toolkit:type-design-analyzer`  | New types or schemas                        |
| `pr-review-toolkit:pr-test-analyzer`      | Test coverage audit                         |
| `pr-review-toolkit:comment-analyzer`      | Comment accuracy check                      |
| `superpowers:code-reviewer`               | Major-step review against plan              |
| `coderabbit:code-reviewer`                | Specialized CodeRabbit analysis             |
| `claude-code-guide`                       | Questions about Claude Code / SDK / API     |
| `vercel:ai-architect`                     | Architecting AI features on Vercel          |
| `vercel:deployment-expert`                | Deployment strategy / CI/CD                 |
| `vercel:performance-optimizer`            | Core Web Vitals / Lighthouse / loading perf |

### 9.23 Free MCP servers to install

| MCP          | Purpose                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| `context7`   | Up-to-date library docs (Next.js, Drizzle, Clerk, AI SDK) — antidote to stale training data |
| `github`     | PR / issue / CI operations                                                                  |
| `playwright` | Browser automation (testing + ACRIS paths)                                                  |
| `serena`     | Semantic code analysis across the monorepo                                                  |
| `firecrawl`  | Web scraping (servicer + county clerk docs)                                                 |
| `pinecone`   | Vector search ops (optional alongside pgvector)                                             |

These give Claude direct tool access to live systems so many of the skills above can do their work autonomously.

### 9.24 Invocation principle

Do not invoke a skill _just because_ it's listed — invoke when its description matches your current task. But err on the side of invoking; skills compound. The full strategic rationale is in [spec §20.18](docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md).

---

## 10. Compliance — non-negotiable constraints

### 10.1 UPL (Unauthorized Practice of Law)

- We are an **attorney-supervised lender tool**. We are NOT a law firm.
- Documents in `kind ∈ {cema_3172, exhibit_*, aff_255, aff_275, aom, allonge, …}` MUST have `attorney_review_required = true`.
- These documents cannot transition to `executed` or `recorded` status without an `AttorneyApproval` event.
- UI must label drafts as "Draft — pending attorney review" until approved.
- Borrower communications must not present unreviewed legal documents.

### 10.2 TCPA / CFPB / NY DFS

- Outbound voice and SMS to borrowers require TCPA opt-in.
- Beep tones / verbal disclosure on call recording, per spec §12.2.
- DNC scrubbing before any outbound borrower call.
- Servicer-to-servicer calls are B2B and outside TCPA, but caller-ID branding and STIR/SHAKEN A-attestation are required.

### 10.3 PII

- Encrypt at rest: SSN, DOB, full payoff figures, account numbers (pgcrypto).
- Never log: same list. Use `redactPii()` middleware.
- 7-year retention on mortgage records (industry standard).
- DSR support (Phase 2) via OneTrust integration.

### 10.4 SOC 2 Type II

- Target: 12 months after first production deployment.
- Vanta tracks controls; every PR potentially impacts a control.
- Don't disable audit log, RLS, or compliance checks for "convenience."

### 10.5 Audit log immutability

- Append-only. Never `UPDATE` or `DELETE` an audit row.
- Every Deal status change, document state transition, attorney approval, communication recording, and PII access emits an audit event.
- Tampering with the audit log is an automatic incident.

---

## 11. Testing

- **Unit:** Vitest, colocated with source (`.test.ts` files).
- **Integration:** Playwright, in `apps/web/tests/e2e/`.
- **Agent evals:** Braintrust, in `packages/agents/<name>/evals/`. Each agent has ≥ 20 fixtures.
- **DB tests:** Each migration must be tested up + down on a Neon branch.
- **Coverage target:** > 70% line coverage on critical packages (`agents`, `idp`, `doc-gen`, `compliance`). Coverage is _not_ the goal — meaningful tests are.

TDD strongly preferred. Invoke `superpowers:test-driven-development` for non-trivial logic.

---

## 12. Deployment

- **Preview:** Every PR → automatic Vercel preview deploy. Preview env vars are isolated.
- **Production:** Merge to `main` → automatic Vercel production deploy.
- **Promotion:** Vercel "promote" requires all status checks green AND a tag (per spec §20.15).
- **Rollback:** Vercel instant rollback to previous deployment via dashboard or CLI.
- **Database migrations:** Run via GitHub Action before deploy. Backward-compatible always — never break running prod with a destructive migration.

---

## 13. Git / GitHub workflow

Full spec in §20 of the design doc. Quick reference:

- Branch: `feat/<scope>`, `fix/<scope>`, etc. From latest `main`.
- Commit: Conventional Commits, signed, body explains _why_.
- PR: small, single-purpose, ≤ 400 LOC diff if possible.
- Required checks: lint, typecheck, test, build, e2e (label-gated), security scan, LLM eval (if agents touched).
- Required reviewers: 1 human (CODEOWNERS) + 1 AI reviewer (CodeRabbit).
- Auto-merge: enabled when green + approved + `auto-merge` label or bot author.
- Auto-delete branch on merge.

---

## 14. Domain glossary

| Term                            | Meaning                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **CEMA**                        | Consolidation, Extension, and Modification Agreement. NY-only mortgage instrument.                                                 |
| **Refi-CEMA**                   | Refinance using CEMA — same borrower. ~75% of CEMA volume.                                                                         |
| **Purchase CEMA**               | Purchase using CEMA — buyer assumes seller's mortgage chain. ~25% of CEMA volume.                                                  |
| **Form 3172**                   | Fannie Mae / Freddie Mac NY CEMA Uniform Instrument. The CEMA agreement itself.                                                    |
| **Gap mortgage**                | New mortgage for the "new money" portion (new loan amount minus prior UPB). The only piece on which recording tax is paid.         |
| **§255 Affidavit**              | NY Tax Law §255 supplemental-mortgage exemption affidavit. Linchpin of the tax savings.                                            |
| **§275 Affidavit**              | NY Tax Law §275 proof-of-prior-tax-paid affidavit.                                                                                 |
| **MT-15**                       | NY Mortgage Recording Tax Return.                                                                                                  |
| **NYS-261**                     | NY Mortgage Affidavit form.                                                                                                        |
| **AOM**                         | Assignment of Mortgage. The instrument by which the prior lender transfers its mortgage to the new lender.                         |
| **Allonge**                     | An attachment to a promissory note that adds endorsements when the note runs out of space.                                         |
| **Collateral file**             | The package the prior servicer delivers: original Note, recorded Mortgage, all intervening Assignments, all Allonges, prior CEMAs. |
| **Chain of title**              | The sequence of recorded mortgages and assignments. Breaks in the chain = re-record or lost-note affidavit.                        |
| **Schedule A**                  | The mortgage-schedule attached to a title commitment — lists every recorded mortgage being consolidated.                           |
| **Schedule B**                  | Exceptions on a title commitment — must be cleared.                                                                                |
| **ACRIS**                       | NYC Automated City Register Information System. Recording system for Manhattan, Bronx, Brooklyn, Queens.                           |
| **CRFN**                        | City Register File Number — ACRIS's recording identifier.                                                                          |
| **Reel/Page**                   | Upstate county clerk's recording identifier.                                                                                       |
| **MERS**                        | Mortgage Electronic Registration Systems — tracks who services a mortgage.                                                         |
| **TIRSA**                       | Title Insurance Rate Service Association — NY title insurance rate-setting body.                                                   |
| **ALTA 11.1-06**                | The ALTA endorsement that insures a mortgage modification with subordination — typical CEMA endorsement.                           |
| **Approved CEMA Attorney List** | List maintained by each major lender — only attorneys on it can close that lender's CEMA.                                          |
| **Servicer**                    | The entity that collects payments on behalf of the mortgage owner. The bottleneck in every CEMA.                                   |
| **UPB**                         | Unpaid Principal Balance — the portion of the existing loan that gets assigned (and is tax-exempt under §255).                     |
| **TCPA**                        | Telephone Consumer Protection Act — federal restrictions on autodialed/recorded calls to consumers.                                |
| **STIR/SHAKEN**                 | Caller-ID authentication framework — required for legitimate outbound calls.                                                       |
| **RON**                         | Remote Online Notarization. Legal in NY. Pavaso / Stavvy / Notarize are the platforms.                                             |
| **IDP**                         | Intelligent Document Processing — OCR + LLM extraction.                                                                            |
| **LOS**                         | Loan Origination System — Encompass, LendingPad, MeridianLink, Calyx.                                                              |
| **POS**                         | Point of Sale — borrower-facing application portal (Blend, Maxwell, Floify).                                                       |

---

## 15. Things to update over time

This file is a living document. Update via the `claude-md-management:revise-claude-md` skill (or by hand for small changes) whenever:

- A new top-level rule emerges from incident or learning
- A tool is added/removed from the stack
- The repo structure changes meaningfully
- A new compliance constraint is identified
- A useful pattern is discovered worth standardizing

Date-stamp the change in `# Changelog` at the bottom.

---

## 16. Open questions

Tracked in spec §18. Reproduced here for visibility:

1. Identify 1–2 design-partner lenders (Connor; needed by Phase 0 month 3)
2. NY bar opinion on UPL posture (external counsel; before Phase 2)
3. E&O insurance broker engagement (Connor; before Phase 1 end)
4. Build internal Servicer ID DB vs. license MERS data feed (Engineering; Phase 1 start)
5. In-house attorney role vs. partner law firm of record (Connor + counsel; Phase 1 end)
6. Product name + domain (Connor; Phase 0 end)
7. Phase-3 voice agent vendor: Conduit vs. Salient vs. Marr Labs vs. Retell (Engineering + Connor; Phase 2 end)

When any of these resolve, update the spec and remove from this list.

---

## 17. Files to read on context-poor sessions

If an AI assistant joins a new session with no context, the priority read order is:

1. **This file (CLAUDE.md)** — the operating manual
2. **[Spec §1–5](docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md)** — what we're building (skim only)
3. **Latest entries in `docs/adr/`** — recent decisions
4. **README.md** — quickstart commands
5. **Recent git log** — what just happened
6. **Open PRs** via `gh pr list` — what's in flight

Do not start coding until at least #1 and the relevant spec section are read.

---

## 18. Cross-environment & multi-agent operations

This project is worked across three contexts:

- **Desktop** (Windows 11, primary) — `C:\Users\conno\Code\Project_CEMA_v1.0.0\`. Full dev loop: `pnpm dev`, Drizzle Studio, browser testing.
- **Laptop** (macOS or Windows) — same repo path under user home. Full dev loop available.
- **Claude Code mobile (cloud)** — read-only / edit-only context. No `pnpm dev`, no browser, no Vercel CLI.

### 18.1 Sync protocol — the single source of truth is GitHub `main`

1. **First action of every session:** `git fetch origin && git status`. If behind, `git pull --rebase origin main` (linear history is enforced).
2. **Never let a local branch sit > 24h behind `main`** without explicitly noting why. Stale branches accumulate merge conflicts and Neon-branch quota usage.
3. **Cross-device work-in-progress:** push WIP commits to a `wip/<scope>` branch rather than leaving uncommitted changes on one machine. Use `git stash` only for very-short-lived state (< 1 hour, same device).
4. **Never** assume the working directory on one device matches another — always pull first.

### 18.2 Dual-account caution

The user owns GitHub repos under **`connorbhickey`** but the local `gh` CLI may be authenticated as **`hicklax13`** (e.g., on the Windows desktop). Before any write operation (push, PR create, issue create, repo settings change):

- Verify with `gh auth status` and `git config user.email`
- If pushing to a `connorbhickey`-owned repo, switch with `gh auth switch -u connorbhickey` and ensure `git config user.email` matches that account's primary email
- **Repo settings writes** (branch protection, environments, secrets) require admin on the owning account — `hicklax13` can read public data but receives `404 Not Found` (GitHub's "leakage-safe forbidden") on any write attempt

### 18.3 Task matrix — what's doable from each device

| Task                                          | Desktop | Laptop | Mobile (Cloud)                        |
| --------------------------------------------- | ------- | ------ | ------------------------------------- |
| Edit code (`*.ts`, `*.tsx`)                   | ✅      | ✅     | ✅                                    |
| Edit docs (specs, plans, ADRs, runbooks)      | ✅      | ✅     | ✅                                    |
| Run `pnpm dev` + browser test                 | ✅      | ✅     | ❌                                    |
| Run `pnpm test` / `typecheck` / `lint`        | ✅      | ✅     | ⚠️ depends on cloud sandbox           |
| Run `pnpm db:migrate` against Neon dev branch | ✅      | ✅     | ⚠️ requires `DATABASE_URL` in sandbox |
| Open PR (`gh pr create`)                      | ✅      | ✅     | ✅                                    |
| Review PR comments + reply                    | ✅      | ✅     | ✅                                    |
| Vercel deploy (`vercel deploy`)               | ✅      | ✅     | ❌ (no CLI auth on cloud)             |
| Drizzle Studio                                | ✅      | ✅     | ❌                                    |
| Playwright e2e (`pnpm test:e2e`)              | ✅      | ✅     | ❌ (no browser)                       |
| Plan iteration / spec edits                   | ✅      | ✅     | ✅ (best mobile use)                  |

When working from mobile/cloud, **defer all dev-loop validation to a desktop session** before merging.

### 18.4 Multi-agent coordination

Multiple Claude Code agents (sessions / subagents / cloud agents) may touch this repo. Coordination rules:

1. **One agent per branch.** Never have two agents working on the same branch simultaneously.
2. **Subagents inherit context but not file locks.** When dispatching, brief the subagent on what files it owns; the parent does not edit them concurrently.
3. **Always pull before editing.** Even within a session, if another agent pushed, `git pull --rebase` first.
4. **Memory hygiene.** Agents save state to `~/.claude/projects/<project>/memory/`. Stale memory + current code disagreement → trust the code, update the memory.

---

## 19. CI failure decision tree

When CI fails on a PR, this is the order of triage:

| Failing check               | First action                                                        | Common root causes                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Lint`                      | `pnpm format:check && pnpm lint` locally                            | Prettier `format:check` covers **all** `*.{md,json,yml,yaml}` (not just code), and lint-staged formats only _staged_ files — unstaged doc edits slip past the hook and fail CI (this caused the M9 admin-bypass); missed `cross-env ESLINT_USE_FLAT_CONFIG=false` prefix; eslint-disabled rule re-flagged                                                                                                    |
| `Typecheck`                 | `pnpm typecheck` locally                                            | Workspace import `.js` extension (Turbopack quirk per ADR-0001 §12); Drizzle type mismatch after schema change; missing `unknown` cast                                                                                                                                                                                                                                                                       |
| `Unit tests`                | `pnpm test --filter <package>` locally                              | Test reads `.env.local` not present in CI; mock drift; `Date.now` flakiness                                                                                                                                                                                                                                                                                                                                  |
| `Build`                     | `pnpm build` locally                                                | Module-level `process.env.DATABASE_URL` access (must be lazy — see ADR-0001 §2); `next/dynamic` ssr toggle issue                                                                                                                                                                                                                                                                                             |
| `db-migrate-check`          | check `packages/db/migrations/meta/_journal.json`                   | Migration deleted from disk but in journal; out-of-order timestamps; non-idempotent DDL                                                                                                                                                                                                                                                                                                                      |
| `security-scan` (GG / Snyk) | `gh secret list`                                                    | `GITGUARDIAN_API_KEY` / `SNYK_TOKEN` not provisioned — soft-fail expected (`continue-on-error: true`)                                                                                                                                                                                                                                                                                                        |
| `e2e` (Playwright)          | `pnpm test:e2e` locally with `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` | Browser install must run in the web workspace (`pnpm --filter web exec playwright install` — the `@playwright/test` binary lives in `apps/web`, not the root; running from root gives `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`); `webServer` is gated on `E2E_USER_EMAIL` so credential-less nightlies skip-green instead of booting `next dev`; Clerk test user not in dev instance; Neon dev branch cold-start |
| `llm-eval`                  | `pnpm eval --filter <agent>` locally                                | Braintrust API key missing; fixture drift; prompt-version not pinned                                                                                                                                                                                                                                                                                                                                         |
| `commitlint`                | `git log --oneline origin/main..HEAD`                               | Non-conventional commit message; missing scope; subject > 72 chars                                                                                                                                                                                                                                                                                                                                           |
| Vercel preview deploy       | Vercel dashboard → deployment logs                                  | Neon branch quota exhausted (Carry-over #3); missing env var in Preview environment; framework auto-detect failure                                                                                                                                                                                                                                                                                           |

**Never bypass with `--no-verify` or admin override** (hard rule #8). Always fix at the root.

---

## Changelog

| Date       | Change                                                                                                                                                                                                                                                                                        | By                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 2026-05-12 | Initial CLAUDE.md created                                                                                                                                                                                                                                                                     | Claude Opus 4.7 + Connor   |
| 2026-05-21 | Added §18 (cross-environment & multi-agent ops) and §19 (CI failure tree)                                                                                                                                                                                                                     | Claude Opus 4.7            |
| 2026-05-21 | §2 carry-over #2 (Husky) marked RESOLVED — was stale since PR #31 landed                                                                                                                                                                                                                      | Claude Opus 4.7            |
| 2026-05-22 | §2 updated: M2 closed (PRs #38–#53), M2 carry-overs listed, next step is M3 email/calendar                                                                                                                                                                                                    | Claude Sonnet 4.6 + Connor |
| 2026-05-22 | §2 updated: M4 closed (33 tasks on feat/m4-messaging-files-esign-contacts), M4 carry-overs listed, next step is M5                                                                                                                                                                            | Claude Sonnet 4.6 + Connor |
| 2026-05-22 | §2 updated: M3 closed (17 tasks on feat/m3-email-calendar), M3 carry-overs listed, next step is M4 internal messaging                                                                                                                                                                         | Claude Opus 4.7            |
| 2026-05-23 | §2 updated: M5 closed (feat/m5-search-memory), M5 carry-overs listed, next step is M6                                                                                                                                                                                                         | Claude Sonnet 4.6 + Connor |
| 2026-05-23 | §2 updated: M6 closed (feat/m6-knowledge-graph-search-memory), M6 carry-overs listed, next step is M7                                                                                                                                                                                         | Claude Sonnet 4.6 + Connor |
| 2026-05-23 | §2 updated: M7 closed (feat/m7-production-pipeline-entity-resolution), M7 carry-overs listed, next step is M8                                                                                                                                                                                 | Claude Sonnet 4.6 + Connor |
| 2026-05-23 | §2 updated: M8 closed (feat/m8-telephony-entity-resolution), M8 carry-overs listed, next step is M9                                                                                                                                                                                           | Claude Sonnet 4.6 + Connor |
| 2026-05-26 | §2 updated: M9 closed (feat/m9-cache-hardening-activity-feed, PR #63), M8 merged via admin-bypass (PR #62), next step is M10                                                                                                                                                                  | Claude Opus 4.7 + Connor   |
| 2026-05-28 | Repaired CI (CLAUDE.md reformat fixes Lint `format:check`; E2E install→`pnpm --filter web exec` + `webServer` gate); optimized §2 (CI-health note) + §19 (Lint/e2e rows); collapsed resolved M1 carry-overs                                                                                   | Claude Opus 4.8 + Connor   |
| 2026-05-28 | Phase 1 kickoff: §2 reconciled to Phase 0→1 transition (M10 Intake Agent next, agent layer ~4mo behind spec §11 roadmap — re-baseline pending Connor approval); added M10 Intake-Agent plan; extended provisioning runbook with Upstash + Cron; added missing `CRON_SECRET` to `.env.example` | Claude Opus 4.8 + Connor   |
