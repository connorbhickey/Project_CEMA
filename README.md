# Project_CEMA

> Vertical AI software that replaces 2–3 CEMA mortgage loan processor FTEs at New York State lender clients.

**Status:** Spec complete, Phase 0 implementation planning underway.
**Phase:** 0 (Foundation — months 1–5).

---

## What is this?

Project_CEMA is a four-layer system for automating NY-state CEMA (Consolidation, Extension, and Modification Agreement) mortgage processing:

1. **Layer 1 — Deal entity + attorney-review gate** (compliance foundation)
2. **Layer 2 — Unified processor workspace** (calls, email, IM, calendar, contacts, files, deadlines — all captured, all queryable)
3. **Layer 3 — CEMA AI agents** (intake, servicer outreach, IDP, chain-of-title, document generation, recording prep)
4. **Layer 4 — Autonomous voice agent** (outbound dialing to prior servicers)

Full design: [docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md](docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md)

---

## Quickstart (once Phase 0 scaffold lands)

```bash
# Enable pnpm via Corepack (one-time)
corepack enable
corepack prepare pnpm@latest --activate

# Install dependencies
pnpm install

# Copy env template and fill in your dev values
cp .env.example .env.local

# Initialize local DB (Neon branch)
pnpm db:setup

# Start dev server (Turbopack)
pnpm dev
```

The repo is currently empty of application code. Phase 0 scaffolding lands as part of the implementation plan output by the `superpowers:writing-plans` skill.

---

## Repository layout (target, post-Phase 0)

```
apps/        # web (Next.js 16), api, admin
packages/    # agents, idp, doc-gen, integrations/*, db, auth, ui, ...
infrastructure/
docs/        # specs, research, compliance, runbooks, ADRs
.github/     # workflows, templates, CODEOWNERS
```

Full tree in [CLAUDE.md §6](CLAUDE.md).

---

## Critical docs

| Doc                                                                                                                            | Purpose                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                                                                                         | AI assistant operating manual — start here if you're an AI |
| [docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md](docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md) | Authoritative design spec — 20 sections                    |
| [docs/research/01-job-tasks-and-automation.md](docs/research/01-job-tasks-and-automation.md)                                   | CEMA processor job duties + automation analysis            |
| [docs/research/02-competitive-landscape.md](docs/research/02-competitive-landscape.md)                                         | Competitive map + uniqueness scoring                       |
| [SECURITY.md](SECURITY.md)                                                                                                     | Responsible disclosure                                     |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                                                                             | How to contribute                                          |

---

## Compliance reminders

This product handles regulated financial information:

- **PII** encrypted at rest; never logged.
- **Attorney-supervised**: every legal document carries a required attorney-review gate.
- **TCPA**: borrower voice/SMS requires explicit opt-in.
- **NY-only** at launch.
- **SOC 2 Type II** target: 12 months after first production deployment.

See [CLAUDE.md §10](CLAUDE.md) for the non-negotiable compliance constraints.

---

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE).
