# CLAUDE.md — Project_CEMA

> **Read this file first.** It is the operating manual for any AI assistant working in this repo. Treat it as authoritative on conventions, constraints, and where to look. The design spec is the authoritative source on *what* we're building; this file is the authoritative source on *how* we work.

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

- **Phase:** **Spec complete, awaiting user approval, implementation plan not yet written.**
- **Next step:** Invoke `superpowers:writing-plans` to produce the Phase 0 implementation plan.
- **Code:** None yet. Repo not initialized. This file ships with the initial commit.

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

| Layer | Choice | Why |
|---|---|---|
| **Framework** | Next.js 16 (App Router, RSC, Cache Components, PPR, Turbopack) | RSC for data-dense pages; Server Actions for forms |
| **Language** | TypeScript (strict mode) | Per global CLAUDE.md |
| **UI** | Tailwind CSS + shadcn/ui + AI Elements | Production design system + AI surfaces |
| **Forms** | react-hook-form + Zod + @hookform/resolvers/zod | Type-safe end-to-end |
| **Client state** | TanStack Query (where RSC isn't enough) | Battle-tested |
| **Database** | Neon Postgres (serverless, branch-per-PR) | Vercel Marketplace native |
| **ORM** | Drizzle | Type-safe; serverless-friendly |
| **Vector** | pgvector (in-DB) + Turbopuffer (scale) | pgvector for per-tenant; Turbopuffer for global |
| **Graph** | Apache AGE extension on Postgres | Avoid Neo4j ops |
| **Blob** | Vercel Blob | Native to Vercel |
| **Cache** | Upstash Redis | Marketplace, serverless |
| **Queue** | Vercel Queues | Native event bus |
| **Durable workflows** | Vercel Workflow DevKit (WDK) primary + Inngest fallback | 75-day CEMA lifecycle requires durability |
| **Cron** | Vercel Cron Jobs | Chase reminders, SLA detection |
| **Sandbox** | Vercel Sandbox | Untrusted code (PDF render, browser automation) |
| **LLM router** | Vercel AI Gateway | Multi-provider, cost tracking, failover |
| **LLM (primary)** | Anthropic Claude Opus 4.7 (`claude-opus-4-7`) | Best agentic tool-use, long context |
| **LLM (workhorse)** | Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`) | 80% of routine tasks |
| **LLM (structured / multimodal)** | OpenAI GPT-5 | Strict JSON, image understanding |
| **LLM (long context)** | Google Gemini 2.5 Pro | When > 200k tokens |
| **STT** | Deepgram Nova-3 (real-time) + Whisper Large v3 (batch) | Best price/perf for telephony |
| **TTS** | ElevenLabs Conversational AI (Phase 3) | Best naturalness |
| **Embeddings** | OpenAI text-embedding-3-large (3072-dim) | Standard |
| **Memory** | Mem0 | Agent-level memory |
| **IDP** | Reducto + AWS Textract Lending + Vaultedge | Tiered |
| **Auth** | Clerk + WorkOS (enterprise SSO) | Vercel Marketplace native |
| **Multi-tenancy** | Postgres RLS + Drizzle policies | Defense in depth |
| **Telephony (agent)** | Twilio Voice primary + Telnyx fallback | STIR/SHAKEN, recording |
| **Email / calendar unified** | Nylas | One API for Gmail + Microsoft Graph |
| **OAuth integration broker** | Nango | Manages 50+ OAuth flows |
| **CRM unified** | Merge.dev | Salesforce + HubSpot + more |
| **eSign** | DocuSign primary + Pavaso (RON) | Mortgage industry standard |
| **Email outbound** | Resend | DX + deliverability |
| **SMS** | Twilio | TCPA-compliant footprint |
| **Observability (app)** | Sentry + Vercel Observability + OpenTelemetry | Errors + traces + RUM |
| **Observability (LLM)** | Braintrust | Evals + traces |
| **Product analytics** | PostHog | Single tool: analytics + flags + replay |
| **Feature flags** | Vercel Flags SDK (PostHog provider) | Native |
| **Notifications** | Knock | Multi-channel prefs |
| **B2B billing** | Stripe Billing + Metronome | Per-deal usage + per-seat |
| **Compliance automation** | Vanta | SOC 2 |
| **Support** | Plain | B2B-native ticketing |
| **CI/CD + hosting** | Vercel | Preview-per-PR, prod promote |
| **Source control** | GitHub (`connorbhickey/Project_CEMA`) | Per global CLAUDE.md |
| **Monorepo** | Turborepo + pnpm | Task graph + workspace |

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

When working in this repo, invoke these skills *before* the relevant work, not after:

| Situation | Invoke |
|---|---|
| Starting any conversation | `superpowers:using-superpowers` (auto-loaded) |
| Building any new feature | `superpowers:brainstorming` first, then `superpowers:writing-plans` |
| Multi-step implementation | `superpowers:executing-plans` |
| Implementing a feature or bugfix | `superpowers:test-driven-development` |
| Encountering a bug | `superpowers:systematic-debugging` |
| Working with Next.js (any change to `apps/web`) | `vercel:nextjs` |
| Working with Workflow DevKit | `vercel:workflow` |
| Working with AI SDK | `vercel:ai-sdk` |
| Working with AI Elements | `vercel:ai-elements` |
| Chat-style UI | `vercel:chat-sdk` |
| Vercel storage (Neon, Blob, Edge Config) | `vercel:vercel-storage` |
| Auth (Clerk / WorkOS) | `vercel:auth` |
| Cron tasks | `vercel:cron-jobs` |
| Runtime cache | `vercel:runtime-cache` |
| Middleware (routing) | `vercel:routing-middleware` |
| Long-running / multi-day workflows | `vercel:workflow` |
| Vercel Sandbox | `vercel:vercel-sandbox` |
| Feature flags | `vercel:vercel-flags` |
| Observability | `vercel:observability` |
| Deploying | `vercel:deploy` |
| Managing env vars | `vercel:env` |
| Verifying full-story end-to-end | `vercel:verification` |
| Stuck / hung / frustrated | `vercel:investigation-mode` |
| Creating commits | `commit-commands:commit` |
| Commit + push + PR | `commit-commands:commit-push-pr` |
| Cleaning [gone] branches | `commit-commands:clean_gone` |
| Reviewing a PR | `pr-review-toolkit:review-pr` |
| Verifying before claiming done | `superpowers:verification-before-completion` |
| Receiving review feedback | `superpowers:receiving-code-review` |
| Updating this CLAUDE.md | `claude-md-management:revise-claude-md` |
| Plugins / hooks / skills development | `plugin-dev:create-plugin` |
| Project bootstrap | `vercel:bootstrap` |

Do not invoke a skill *just because* it's listed — invoke when its description matches your current task. But err on the side of invoking; skills compound.

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
- **Coverage target:** > 70% line coverage on critical packages (`agents`, `idp`, `doc-gen`, `compliance`). Coverage is *not* the goal — meaningful tests are.

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
- Commit: Conventional Commits, signed, body explains *why*.
- PR: small, single-purpose, ≤ 400 LOC diff if possible.
- Required checks: lint, typecheck, test, build, e2e (label-gated), security scan, LLM eval (if agents touched).
- Required reviewers: 1 human (CODEOWNERS) + 1 AI reviewer (CodeRabbit).
- Auto-merge: enabled when green + approved + `auto-merge` label or bot author.
- Auto-delete branch on merge.

---

## 14. Domain glossary

| Term | Meaning |
|---|---|
| **CEMA** | Consolidation, Extension, and Modification Agreement. NY-only mortgage instrument. |
| **Refi-CEMA** | Refinance using CEMA — same borrower. ~75% of CEMA volume. |
| **Purchase CEMA** | Purchase using CEMA — buyer assumes seller's mortgage chain. ~25% of CEMA volume. |
| **Form 3172** | Fannie Mae / Freddie Mac NY CEMA Uniform Instrument. The CEMA agreement itself. |
| **Gap mortgage** | New mortgage for the "new money" portion (new loan amount minus prior UPB). The only piece on which recording tax is paid. |
| **§255 Affidavit** | NY Tax Law §255 supplemental-mortgage exemption affidavit. Linchpin of the tax savings. |
| **§275 Affidavit** | NY Tax Law §275 proof-of-prior-tax-paid affidavit. |
| **MT-15** | NY Mortgage Recording Tax Return. |
| **NYS-261** | NY Mortgage Affidavit form. |
| **AOM** | Assignment of Mortgage. The instrument by which the prior lender transfers its mortgage to the new lender. |
| **Allonge** | An attachment to a promissory note that adds endorsements when the note runs out of space. |
| **Collateral file** | The package the prior servicer delivers: original Note, recorded Mortgage, all intervening Assignments, all Allonges, prior CEMAs. |
| **Chain of title** | The sequence of recorded mortgages and assignments. Breaks in the chain = re-record or lost-note affidavit. |
| **Schedule A** | The mortgage-schedule attached to a title commitment — lists every recorded mortgage being consolidated. |
| **Schedule B** | Exceptions on a title commitment — must be cleared. |
| **ACRIS** | NYC Automated City Register Information System. Recording system for Manhattan, Bronx, Brooklyn, Queens. |
| **CRFN** | City Register File Number — ACRIS's recording identifier. |
| **Reel/Page** | Upstate county clerk's recording identifier. |
| **MERS** | Mortgage Electronic Registration Systems — tracks who services a mortgage. |
| **TIRSA** | Title Insurance Rate Service Association — NY title insurance rate-setting body. |
| **ALTA 11.1-06** | The ALTA endorsement that insures a mortgage modification with subordination — typical CEMA endorsement. |
| **Approved CEMA Attorney List** | List maintained by each major lender — only attorneys on it can close that lender's CEMA. |
| **Servicer** | The entity that collects payments on behalf of the mortgage owner. The bottleneck in every CEMA. |
| **UPB** | Unpaid Principal Balance — the portion of the existing loan that gets assigned (and is tax-exempt under §255). |
| **TCPA** | Telephone Consumer Protection Act — federal restrictions on autodialed/recorded calls to consumers. |
| **STIR/SHAKEN** | Caller-ID authentication framework — required for legitimate outbound calls. |
| **RON** | Remote Online Notarization. Legal in NY. Pavaso / Stavvy / Notarize are the platforms. |
| **IDP** | Intelligent Document Processing — OCR + LLM extraction. |
| **LOS** | Loan Origination System — Encompass, LendingPad, MeridianLink, Calyx. |
| **POS** | Point of Sale — borrower-facing application portal (Blend, Maxwell, Floify). |

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

## Changelog

| Date | Change | By |
|---|---|---|
| 2026-05-12 | Initial CLAUDE.md created | Claude Opus 4.7 + Connor |
