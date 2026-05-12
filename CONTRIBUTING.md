# Contributing to Project_CEMA

This is a private, proprietary project. Access is limited to invited
collaborators. If you've been given access, this document explains how to
contribute.

---

## Before you start

1. Read [CLAUDE.md](CLAUDE.md) — operating manual.
2. Skim the [design spec](docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md) — at minimum §1–§5 and the sections relevant to your task.
3. Set up your dev environment (see [README.md](README.md)).
4. Ensure your editor is configured for our tooling (Prettier, ESLint, EditorConfig).

---

## Branches

- Trunk-based: `main` is always deployable.
- Feature work: `feat/<scope>` from latest `main`.
- Bug fixes: `fix/<scope>`.
- Other: `chore/<scope>`, `docs/<scope>`, `refactor/<scope>`, `test/<scope>`, `perf/<scope>`, `ci/<scope>`.
- Keep branches short-lived (≤ 5 business days).

---

## Commits

We use **Conventional Commits**:

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **Type**: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`, `style`.
- **Scope**: the affected package or app (e.g., `feat(agents/servicer-outreach): ...`).
- **Subject**: imperative mood, no period, ≤ 72 chars.
- **Body** (optional): explain *why*, not *what*. The diff explains what.
- **Footer** (optional): `Closes #123`, `BREAKING CHANGE: ...`, co-authors.

**Signed commits are required.** Configure GPG or SSH signing before your first commit:

```bash
git config --local commit.gpgSign true
# (or use SSH key signing)
```

---

## Pull requests

1. Open early as draft if you want feedback in progress.
2. Use the PR template (auto-populated).
3. Keep PRs small — ≤ 400 LOC diff if possible.
4. Single purpose per PR.
5. Resolve all conversation threads before requesting re-review.
6. CI must pass before merge.
7. Squash-and-merge on approval — PR title becomes the commit message.

### Required checks (all must pass)

- `ci` (lint + typecheck + unit tests + build)
- `db-migrate-check` (if migrations changed)
- `security-scan` (CodeQL + Snyk + GitGuardian)
- `llm-eval` (if agents or prompts changed)
- Vercel preview deploy

### Reviewers

- 1 human reviewer from CODEOWNERS
- 1 AI reviewer (CodeRabbit) — automatic on PR open

---

## Testing

- **TDD strongly preferred** for non-trivial logic.
- **Unit tests** colocated with source (`*.test.ts`).
- **Integration tests** in `apps/web/tests/e2e/`.
- **Agent evals** in `packages/agents/<name>/evals/`.

Use the `superpowers:test-driven-development` skill to enforce the discipline.

---

## Compliance — must-knows for contributors

These rules are non-negotiable. PRs violating them will be blocked.

1. **No PII in logs.** Use `redactPii()` middleware.
2. **No bypass of the attorney-review gate** on legal documents.
3. **No commits of secrets.** `.env.local` is gitignored; never check in real values.
4. **TCPA opt-in required** before outbound borrower voice/SMS.
5. **Audit log is append-only** — never UPDATE or DELETE rows.

Full compliance constraints in [CLAUDE.md §10](CLAUDE.md).

---

## Code style

- TypeScript strict mode everywhere.
- 100-column line length.
- Prettier formats on save (configured in `.prettierrc`).
- Functional React components with hooks; no class components.
- Server Components by default; mark Client Components explicitly with `'use client'`.
- Tailwind for styling; shadcn/ui for primitives.

---

## Architecture decisions

When making a non-trivial architectural choice:

1. Write an ADR in `docs/adr/NNNN-<slug>.md` using the [ADR template](docs/adr/0000-template.md).
2. Link the ADR from your PR.
3. Get the architecture reviewer's approval before implementing.

---

## Getting help

- Stuck on tooling: ask in `#engineering` Slack.
- Compliance question: ask in `#compliance` Slack or escalate to legal counsel.
- Domain (CEMA workflow) question: re-read the research docs first; then ask.

---

Thank you for contributing!
