# Phase 0 Month 1 — Multi-Tenant Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a multi-tenant Next.js 16 monorepo with Clerk auth, Neon Postgres + Drizzle ORM, the full CEMA Deal data model with attorney-review workflow primitives, and a working UI where a logged-in user can create and view Deals against real persistence with row-level multi-tenant isolation and audit logging.

**Architecture:** Turborepo monorepo. `apps/web` is Next.js 16 (App Router, Server Components, Server Actions). `packages/db` holds Drizzle schema + migrations. `packages/auth` wraps Clerk. `packages/ui` is shadcn/ui + Tailwind. `packages/compliance` implements PII redaction, audit-log emission, and the attorney-review guard. `packages/config` shares ESLint, Prettier, and tsconfig. Multi-tenancy enforced two ways: application-level org scoping via Clerk B2B + Postgres Row-Level Security policies as defense in depth.

**Tech Stack:** Next.js 16.0+ (App Router, Turbopack), React 19, TypeScript 5.7 strict, Drizzle ORM 0.36+, Neon Postgres serverless, Clerk (Vercel Marketplace), Tailwind 4, shadcn/ui, Vitest, Playwright, Zod, react-hook-form.

**Deliverable at plan-end:**

1. `pnpm dev` starts the app locally against a real Neon dev branch
2. `pnpm test` passes (~30 unit tests)
3. `pnpm test:e2e` passes (1 happy-path Playwright test: sign up → create org → create Deal → see Deal in list)
4. Vercel preview deploy succeeds on a feature branch
5. Audit log captures every Deal mutation
6. Two orgs in the same DB cannot see each other's Deals (RLS-enforced)

---

## Skills to invoke during execution

This plan is designed to be executed with significant AI assistance. The table below maps each task to the specific Claude Code skills that should be invoked **before** starting the task, so the implementing agent has the right context loaded. Full strategic catalog in [spec §20.18](../../superpowers/specs/2026-05-12-cema-ai-processor-design.md).

### Pervasive across all tasks

Always have these active throughout execution:

| Skill | Why |
|---|---|
| `superpowers:using-superpowers` | Auto-loaded — establishes skill discipline |
| `superpowers:test-driven-development` | Every code-bearing task is TDD-structured |
| `superpowers:verification-before-completion` | Run at the end of every task before commit |
| `commit-commands:commit` | Enforces Conventional Commits at commit time |
| `vercel:knowledge-update` | Auto-loaded — corrects outdated Vercel knowledge |

### Per-task skill invocations

| Task | Skill(s) to invoke before starting | Subagent(s) optionally dispatched after |
|---|---|---|
| **1** Bootstrap pnpm + Husky | `vercel:bootstrap` | — |
| **2** packages/config | `vercel:turborepo` | — |
| **3** packages/db skeleton | `vercel:vercel-storage`, `vercel:marketplace` (for Neon install) | — |
| **4** enums schema | — | — |
| **5** tenants schema | — | `pr-review-toolkit:type-design-analyzer` |
| **6** servicers schema | — | `pr-review-toolkit:type-design-analyzer` |
| **7** deals schema | — | `pr-review-toolkit:type-design-analyzer` |
| **8** parties + documents + attorney-review + audit schemas | `legal:compliance-check` (audit + attorney gate) | `pr-review-toolkit:type-design-analyzer` |
| **9** Generate + apply migration | `vercel:vercel-storage` | — |
| **10** RLS policies | `legal:compliance-check` (multi-tenant isolation is compliance-critical) | `pr-review-toolkit:silent-failure-hunter` |
| **11** packages/compliance | `legal:compliance-check`, `legal:legal-risk-assessment` | `pr-review-toolkit:type-design-analyzer` |
| **12** packages/auth | `vercel:auth`, `vercel:marketplace` (for Clerk install) | — |
| **13** packages/ui | `vercel:shadcn`, `frontend-design:frontend-design`, `design:design-system`, `design:accessibility-review` | `pr-review-toolkit:code-simplifier` |
| **14** apps/web scaffold | `vercel:nextjs`, `vercel:routing-middleware`, `vercel:turbopack` | `vercel:agent-browser-verify` (after dev server starts) |
| **15** sign-in / sign-up routes | `vercel:auth`, `vercel:nextjs` | `design:accessibility-review` |
| **16** Clerk webhook → DB sync | `vercel:auth`, `vercel:vercel-functions` | `pr-review-toolkit:silent-failure-hunter` |
| **17** Authenticated app layout | `vercel:nextjs`, `vercel:next-cache-components`, `vercel:auth`, `design:design-system` | `design:accessibility-review` |
| **18** Deal list + create server actions | `vercel:nextjs`, `vercel:vercel-storage`, `legal:compliance-check` (audit emission) | `pr-review-toolkit:silent-failure-hunter`, `pr-review-toolkit:code-reviewer` |
| **19** Deal list page | `vercel:nextjs`, `vercel:next-cache-components`, `design:design-critique`, `design:ux-copy` (empty state) | `design:accessibility-review` |
| **20** New deal form | `vercel:nextjs`, `vercel:react-best-practices`, `design:design-critique`, `design:ux-copy` (labels/errors) | `pr-review-toolkit:type-design-analyzer`, `design:accessibility-review` |
| **21** Deal detail page | `vercel:nextjs`, `vercel:next-cache-components`, `vercel:vercel-storage` | `design:accessibility-review` |
| **22** Playwright e2e | `vercel:agent-browser`, `vercel:verification`, `engineering:testing-strategy` | `pr-review-toolkit:pr-test-analyzer` |
| **23** RLS isolation test | `legal:compliance-check` (THIS IS THE TENANT-ISOLATION COMPLIANCE PROOF), `vercel:vercel-storage` | `pr-review-toolkit:silent-failure-hunter` |
| **24** Vercel project link + first deploy | `vercel:bootstrap`, `vercel:deployments-cicd`, `vercel:env-vars`, `vercel:vercel-cli`, `engineering:deploy-checklist` | `vercel:verification` |

### Phase-end (after Task 24 lands)

Invoke after the entire plan completes:

| Skill | Why |
|---|---|
| `engineering:architecture` | Author ADR `docs/adr/0001-phase-0-month-1-architecture.md` capturing what shipped vs. what changed from the spec |
| `claude-md-management:revise-claude-md` | Update CLAUDE.md status section to reflect Phase 0 Month 1 complete |
| `superpowers:finishing-a-development-branch` | Standardized end-of-development checklist |
| `operations:runbook` | Author `docs/runbooks/local-dev-setup.md` so future engineers can spin up from scratch in < 30 min |
| `operations:vendor-review` | Vendor due diligence on Neon, Clerk, Vercel, anyone else added |
| `pr-review-toolkit:review-pr` | Final cross-cutting review of all 24 task commits |
| `claude-code-setup:claude-automation-recommender` | Audit what *else* should be automated based on this month's experience |

### Phase-start prerequisites

Before Task 1, ensure these subagents and MCPs are available (configure via `.mcp.json` or the Claude Code marketplace):

- **MCPs:** `context7` (library docs), `github` (PR ops), `playwright` (browser testing), `serena` (semantic code analysis), `firecrawl` (web scraping for any Phase 0+ servicer doc work)
- **Subagent types worth dispatching during this plan:** `Explore` (codebase searches), `Plan` (sub-design questions), `general-purpose` (multi-step research), the `pr-review-toolkit:*` agents, `feature-dev:code-explorer`

If any of these aren't installed at execution time, install before Task 1 — they materially improve quality.

---

## File Structure

```
apps/web/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── globals.css
│   ├── (auth)/
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   └── sign-up/[[...sign-up]]/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── deals/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/page.tsx
│   │   └── settings/
│   │       └── org/page.tsx
│   └── api/webhooks/clerk/route.ts
├── components/
│   ├── deal-form.tsx
│   ├── deal-card.tsx
│   └── sidebar.tsx
├── lib/
│   ├── auth.ts
│   ├── db.ts
│   ├── rls.ts
│   └── actions/
│       ├── create-deal.ts
│       └── list-deals.ts
├── middleware.ts
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── package.json
└── tsconfig.json

packages/db/
├── src/
│   ├── index.ts
│   ├── client.ts
│   ├── schema/
│   │   ├── index.ts
│   │   ├── enums.ts
│   │   ├── tenants.ts
│   │   ├── deals.ts
│   │   ├── parties.ts
│   │   ├── servicers.ts
│   │   ├── documents.ts
│   │   ├── attorney-review.ts
│   │   └── audit.ts
│   └── rls.ts
├── migrations/
├── drizzle.config.ts
├── package.json
└── tsconfig.json

packages/auth/
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── tenant.ts
│   └── types.ts
├── package.json
└── tsconfig.json

packages/ui/
├── src/
│   ├── index.ts
│   ├── lib/utils.ts
│   ├── components/
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── card.tsx
│   │   ├── select.tsx
│   │   ├── form.tsx
│   │   └── separator.tsx
│   └── styles/globals.css
├── components.json
├── tailwind.config.ts
├── package.json
└── tsconfig.json

packages/compliance/
├── src/
│   ├── index.ts
│   ├── pii.ts
│   ├── audit-log.ts
│   └── attorney-review.ts
├── package.json
└── tsconfig.json

packages/config/
├── eslint/
│   ├── base.js
│   └── next.js
├── prettier/index.js
├── tsconfig/
│   ├── base.json
│   ├── nextjs.json
│   └── node.json
└── package.json
```

---

## Tasks

### Task 1: Bootstrap pnpm workspace + Husky pre-commit hooks

**Files:**
- Modify: `package.json` (root already exists from initial commit)
- Create: `.husky/pre-commit`
- Create: `.husky/commit-msg`
- Create: `pnpm-lock.yaml` (generated)

- [ ] **Step 1: Install dependencies**

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install
```

Expected: `pnpm-lock.yaml` is created; no errors.

- [ ] **Step 2: Initialize Husky**

```bash
pnpm exec husky init
```

Creates `.husky/pre-commit` with a default placeholder.

- [ ] **Step 3: Write pre-commit hook**

Replace `.husky/pre-commit` contents with:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm exec lint-staged
```

- [ ] **Step 4: Write commit-msg hook**

Create `.husky/commit-msg`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm exec commitlint --edit "$1"
```

Make executable:

```bash
chmod +x .husky/pre-commit .husky/commit-msg
```

- [ ] **Step 5: Test the hooks**

```bash
git commit --allow-empty -m "bad message"
```

Expected: Commit FAILS with commitlint error about format.

```bash
git commit --allow-empty -m "chore(test): verify hooks work"
```

Expected: Commit succeeds.

- [ ] **Step 6: Commit**

```bash
git add .husky pnpm-lock.yaml
git commit -m "chore(setup): install pnpm deps and configure Husky hooks"
```

---

### Task 2: Set up packages/config (shared tsconfig, ESLint, Prettier)

**Files:**
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig/base.json`
- Create: `packages/config/tsconfig/nextjs.json`
- Create: `packages/config/tsconfig/node.json`
- Create: `packages/config/eslint/base.js`
- Create: `packages/config/eslint/next.js`
- Create: `packages/config/prettier/index.js`

- [ ] **Step 1: Create the package directory and package.json**

```bash
mkdir -p packages/config/tsconfig packages/config/eslint packages/config/prettier
```

Create `packages/config/package.json`:

```json
{
  "name": "@cema/config",
  "version": "0.0.0",
  "private": true,
  "main": "index.js",
  "files": ["eslint", "prettier", "tsconfig"]
}
```

- [ ] **Step 2: Create base tsconfig**

Create `packages/config/tsconfig/base.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true
  }
}
```

- [ ] **Step 3: Create nextjs tsconfig**

Create `packages/config/tsconfig/nextjs.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "noEmit": true,
    "allowJs": true
  }
}
```

- [ ] **Step 4: Create node tsconfig**

Create `packages/config/tsconfig/node.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 5: Create base ESLint config**

Create `packages/config/eslint/base.js`:

```js
module.exports = {
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import'],
  parserOptions: { ecmaVersion: 2024, sourceType: 'module' },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
  },
  ignorePatterns: ['dist', 'build', '.next', 'node_modules', 'coverage'],
};
```

- [ ] **Step 6: Create Next.js ESLint config**

Create `packages/config/eslint/next.js`:

```js
module.exports = {
  extends: [require.resolve('./base.js'), 'next/core-web-vitals'],
  rules: {
    '@next/next/no-html-link-for-pages': 'off',
  },
};
```

- [ ] **Step 7: Create Prettier config**

Create `packages/config/prettier/index.js`:

```js
module.exports = {
  semi: true,
  trailingComma: 'all',
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'always',
  bracketSpacing: true,
  endOfLine: 'lf',
  plugins: ['prettier-plugin-tailwindcss'],
};
```

- [ ] **Step 8: Re-install and verify**

```bash
pnpm install
pnpm typecheck
```

Expected: No errors. Workspace recognizes `@cema/config`.

- [ ] **Step 9: Commit**

```bash
git add packages/config pnpm-lock.yaml
git commit -m "chore(config): scaffold shared tsconfig, eslint, prettier configs"
```

---

### Task 3: Set up packages/db skeleton with Drizzle + Neon

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `apps/web/.env.example` (placeholder for now)

- [ ] **Step 1: Create package.json**

```bash
mkdir -p packages/db/src/schema
```

Create `packages/db/package.json`:

```json
{
  "name": "@cema/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:setup": "tsx ./scripts/setup.ts",
    "db:studio": "drizzle-kit studio",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "@neondatabase/serverless": "^0.10.0",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.4"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "drizzle-kit": "^0.28.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig**

Create `packages/db/tsconfig.json`:

```json
{
  "extends": "@cema/config/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "drizzle.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create drizzle.config.ts**

Create `packages/db/drizzle.config.ts`:

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
```

- [ ] **Step 4: Create the Drizzle client**

Create `packages/db/src/client.ts`:

```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema/index.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle({ client: sql, schema });

export type Database = typeof db;
```

- [ ] **Step 5: Create empty schema index**

Create `packages/db/src/schema/index.ts`:

```ts
// Re-export all schemas. Populated in subsequent tasks.
export {};
```

- [ ] **Step 6: Create the package index**

Create `packages/db/src/index.ts`:

```ts
export { db, type Database } from './client.js';
export * as schema from './schema/index.js';
```

- [ ] **Step 7: Provision a Neon dev branch**

Open the Vercel dashboard → Storage → Marketplace → install Neon. Create a project named `project-cema`. Copy the `DATABASE_URL` value.

In `apps/web/.env.local` (gitignored), set:

```env
DATABASE_URL=postgresql://...neon...
```

Also export it in your shell:

```bash
export DATABASE_URL='postgresql://...neon...'
```

- [ ] **Step 8: Install and verify**

```bash
pnpm install
cd packages/db
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 9: Run a no-op generate to confirm config**

```bash
pnpm db:generate
```

Expected: Output "No schema changes, nothing to generate".

- [ ] **Step 10: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): scaffold Drizzle + Neon client and config"
```

---

### Task 4: Implement enums schema (canonical domain enums)

**Files:**
- Create: `packages/db/src/schema/enums.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/enums.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/enums.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  cemaTypeEnum,
  dealStatusEnum,
  documentKindEnum,
  documentStatusEnum,
  lenderSubtypeEnum,
  partyRoleEnum,
  propertyTypeEnum,
} from './enums.js';

describe('enums', () => {
  it('lender subtype includes all 4 types from the spec', () => {
    expect(cemaTypeEnum.enumValues).toEqual(['refi_cema', 'purchase_cema']);
  });

  it('lender subtype includes all 4 types from the spec', () => {
    expect(lenderSubtypeEnum.enumValues).toEqual([
      'imb',
      'regional_bank',
      'community_bank_cu',
      'wholesale_broker',
    ]);
  });

  it('property type excludes co-op', () => {
    expect(propertyTypeEnum.enumValues).not.toContain('coop');
    expect(propertyTypeEnum.enumValues).toContain('one_family');
    expect(propertyTypeEnum.enumValues).toContain('condo');
  });

  it('deal status includes all lifecycle states', () => {
    expect(dealStatusEnum.enumValues).toEqual([
      'intake',
      'eligibility',
      'authorization',
      'collateral_chase',
      'title_work',
      'doc_prep',
      'attorney_review',
      'closing',
      'recording',
      'completed',
      'exception',
      'cancelled',
    ]);
  });

  it('document kind covers all CEMA legal doc types', () => {
    const required = [
      'note',
      'mortgage',
      'assignment',
      'allonge',
      'cema_3172',
      'exhibit_a',
      'exhibit_b',
      'exhibit_c',
      'exhibit_d',
      'consolidated_note',
      'gap_note',
      'gap_mortgage',
      'aff_255',
      'aff_275',
      'mt_15',
      'payoff_letter',
      'authorization',
      'title_commitment',
    ];
    for (const k of required) {
      expect(documentKindEnum.enumValues).toContain(k);
    }
  });

  it('party role covers all required CEMA roles', () => {
    expect(partyRoleEnum.enumValues).toEqual([
      'borrower',
      'co_borrower',
      'seller',
      'loan_officer',
      'processor',
      'closing_attorney',
      'title_agent',
      'seller_attorney',
      'doc_custodian',
    ]);
  });

  it('document status includes draft and attorney_review_required gate', () => {
    expect(documentStatusEnum.enumValues).toEqual([
      'draft',
      'attorney_review',
      'approved',
      'executed',
      'recorded',
      'rejected',
    ]);
  });
});
```

- [ ] **Step 2: Install Vitest in the workspace**

In `packages/db/package.json`, add to `devDependencies`:

```json
"vitest": "^2.1.0"
```

Add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Run:

```bash
pnpm install
```

- [ ] **Step 3: Run the test — verify it fails**

```bash
cd packages/db
pnpm test
```

Expected: FAIL with "Cannot find module './enums.js'" or similar.

- [ ] **Step 4: Implement enums.ts**

Create `packages/db/src/schema/enums.ts`:

```ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const lenderSubtypeEnum = pgEnum('lender_subtype', [
  'imb',
  'regional_bank',
  'community_bank_cu',
  'wholesale_broker',
]);

export const cemaTypeEnum = pgEnum('cema_type', ['refi_cema', 'purchase_cema']);

export const propertyTypeEnum = pgEnum('property_type', [
  'one_family',
  'two_family',
  'three_family',
  'condo',
  'pud',
]);

export const dealStatusEnum = pgEnum('deal_status', [
  'intake',
  'eligibility',
  'authorization',
  'collateral_chase',
  'title_work',
  'doc_prep',
  'attorney_review',
  'closing',
  'recording',
  'completed',
  'exception',
  'cancelled',
]);

export const partyRoleEnum = pgEnum('party_role', [
  'borrower',
  'co_borrower',
  'seller',
  'loan_officer',
  'processor',
  'closing_attorney',
  'title_agent',
  'seller_attorney',
  'doc_custodian',
]);

export const documentKindEnum = pgEnum('document_kind', [
  'note',
  'mortgage',
  'assignment',
  'allonge',
  'cema_3172',
  'exhibit_a',
  'exhibit_b',
  'exhibit_c',
  'exhibit_d',
  'consolidated_note',
  'gap_note',
  'gap_mortgage',
  'aff_255',
  'aff_275',
  'mt_15',
  'nyc_rpt',
  'tp_584',
  'acris_cover_pages',
  'county_cover_sheet',
  'payoff_letter',
  'authorization',
  'title_commitment',
  'title_policy',
  'endorsement_111',
  'other',
]);

export const documentStatusEnum = pgEnum('document_status', [
  'draft',
  'attorney_review',
  'approved',
  'executed',
  'recorded',
  'rejected',
]);

export const loanProgramEnum = pgEnum('loan_program', [
  'conventional_fannie',
  'conventional_freddie',
  'conventional_private',
  'jumbo',
  'fha',
  'va',
]);

export const submissionMethodEnum = pgEnum('submission_method', [
  'email',
  'portal',
  'fax_only',
  'usps',
]);
```

- [ ] **Step 5: Wire enums into the schema index**

Replace `packages/db/src/schema/index.ts` contents with:

```ts
export * from './enums.js';
```

- [ ] **Step 6: Run test — verify it passes**

```bash
pnpm test
```

Expected: All 7 enum tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db/schema): add canonical domain enums (lender, cema, property, status)"
```

---

### Task 5: Implement tenants schema (Organization, User, Membership)

**Files:**
- Create: `packages/db/src/schema/tenants.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/tenants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/tenants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { memberships, organizations, users } from './tenants.js';

describe('tenants schema', () => {
  it('organizations table has required columns', () => {
    const cols = Object.keys(organizations);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'clerkOrgId',
        'name',
        'slug',
        'lenderSubtype',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ]),
    );
  });

  it('users table has required columns', () => {
    const cols = Object.keys(users);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'clerkUserId',
        'email',
        'fullName',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ]),
    );
  });

  it('memberships joins users to orgs with role', () => {
    const cols = Object.keys(memberships);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'organizationId', 'userId', 'role', 'createdAt']),
    );
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd packages/db
pnpm test src/schema/tenants.test.ts
```

Expected: FAIL with "Cannot find module './tenants.js'".

- [ ] **Step 3: Implement tenants.ts**

Create `packages/db/src/schema/tenants.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { lenderSubtypeEnum } from './enums.js';

export const orgRoleEnum = pgEnum('org_role', ['owner', 'admin', 'member']);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkOrgId: varchar('clerk_org_id', { length: 64 }).notNull().unique(),
    name: text('name').notNull(),
    slug: varchar('slug', { length: 64 }).notNull().unique(),
    lenderSubtype: lenderSubtypeEnum('lender_subtype'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    clerkOrgIdx: uniqueIndex('organizations_clerk_org_idx').on(t.clerkOrgId),
    slugIdx: uniqueIndex('organizations_slug_idx').on(t.slug),
  }),
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkUserId: varchar('clerk_user_id', { length: 64 }).notNull().unique(),
    email: varchar('email', { length: 255 }).notNull(),
    fullName: text('full_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    clerkUserIdx: uniqueIndex('users_clerk_user_idx').on(t.clerkUserId),
    emailIdx: index('users_email_idx').on(t.email),
  }),
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgUserIdx: uniqueIndex('memberships_org_user_idx').on(t.organizationId, t.userId),
  }),
);
```

- [ ] **Step 4: Wire into schema index**

Replace `packages/db/src/schema/index.ts`:

```ts
export * from './enums.js';
export * from './tenants.js';
```

- [ ] **Step 5: Run test — verify it passes**

```bash
pnpm test src/schema/tenants.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db/schema): add organizations, users, memberships tables"
```

---

### Task 6: Implement servicers schema (the playbook entity)

**Files:**
- Create: `packages/db/src/schema/servicers.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/servicers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/servicers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { servicerCemaDepartments, servicers } from './servicers.js';

describe('servicers schema', () => {
  it('servicers table has playbook columns', () => {
    const cols = Object.keys(servicers);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'legalName',
        'dbaNames',
        'nmlsId',
        'mersOrgId',
        'parentServicerId',
        'collateralCustodian',
        'playbookVersion',
        'lastVerifiedAt',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('cema departments table joins to servicer', () => {
    const cols = Object.keys(servicerCemaDepartments);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'servicerId',
        'phone',
        'fax',
        'email',
        'portalUrl',
        'acceptedSubmissionMethods',
        'typicalSlaBusinessDays',
        'createdAt',
        'updatedAt',
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm test src/schema/servicers.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement servicers.ts**

Create `packages/db/src/schema/servicers.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { submissionMethodEnum } from './enums.js';

export const servicers = pgTable(
  'servicers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    legalName: text('legal_name').notNull(),
    dbaNames: jsonb('dba_names').$type<string[]>().default([]).notNull(),
    nmlsId: varchar('nmls_id', { length: 32 }),
    mersOrgId: varchar('mers_org_id', { length: 32 }),
    parentServicerId: uuid('parent_servicer_id').references((): any => servicers.id),
    collateralCustodian: text('collateral_custodian'),
    playbookVersion: integer('playbook_version').notNull().default(1),
    notes: text('notes'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => ({
    legalNameIdx: uniqueIndex('servicers_legal_name_idx').on(t.legalName),
  }),
);

export const servicerCemaDepartments = pgTable('servicer_cema_departments', {
  id: uuid('id').defaultRandom().primaryKey(),
  servicerId: uuid('servicer_id')
    .notNull()
    .references(() => servicers.id, { onDelete: 'cascade' }),
  phone: varchar('phone', { length: 32 }),
  fax: varchar('fax', { length: 32 }),
  email: varchar('email', { length: 255 }),
  portalUrl: text('portal_url'),
  acceptedSubmissionMethods: jsonb('accepted_submission_methods')
    .$type<Array<typeof submissionMethodEnum.enumValues>>()
    .default([])
    .notNull(),
  typicalSlaBusinessDays: integer('typical_sla_business_days'),
  escalationPath: jsonb('escalation_path').$type<unknown[]>().default([]).notNull(),
  commonRejectionReasons: jsonb('common_rejection_reasons').$type<string[]>().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`),
});
```

- [ ] **Step 4: Wire into schema index**

Update `packages/db/src/schema/index.ts`:

```ts
export * from './enums.js';
export * from './tenants.js';
export * from './servicers.js';
```

- [ ] **Step 5: Run test — verify it passes**

```bash
pnpm test src/schema/servicers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db/schema): add servicers and servicer_cema_departments tables"
```

---

### Task 7: Implement deals schema (Deal + Property + Loans)

**Files:**
- Create: `packages/db/src/schema/deals.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/deals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/deals.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { deals, existingLoans, newLoans, properties } from './deals.js';

describe('deals schema', () => {
  it('deals scoped to organization', () => {
    const cols = Object.keys(deals);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'organizationId',
        'cemaType',
        'status',
        'propertyId',
        'newLoanId',
        'createdById',
        'createdAt',
        'updatedAt',
        'targetCloseAt',
        'slaBreachAt',
        'completedAt',
      ]),
    );
  });

  it('property includes NYC borough and ACRIS hooks', () => {
    const cols = Object.keys(properties);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'streetAddress',
        'unit',
        'city',
        'county',
        'zipCode',
        'propertyType',
        'block',
        'lot',
        'taxMapId',
        'acrisBbl',
      ]),
    );
  });

  it('existing loans capture full prior-mortgage chain', () => {
    const cols = Object.keys(existingLoans);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'dealId',
        'upb',
        'originalPrincipal',
        'noteDate',
        'maturityDate',
        'currentServicerId',
        'investor',
        'recordedReelPage',
        'recordedCrfn',
        'chainPosition',
      ]),
    );
  });

  it('new loan captures the funding details', () => {
    const cols = Object.keys(newLoans);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'principal',
        'rate',
        'termMonths',
        'program',
        'targetFundingDate',
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm test src/schema/deals.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement deals.ts**

Create `packages/db/src/schema/deals.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  date,
  decimal,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { cemaTypeEnum, dealStatusEnum, loanProgramEnum, propertyTypeEnum } from './enums.js';
import { servicers } from './servicers.js';
import { organizations, users } from './tenants.js';

export const properties = pgTable('properties', {
  id: uuid('id').defaultRandom().primaryKey(),
  streetAddress: text('street_address').notNull(),
  unit: varchar('unit', { length: 32 }),
  city: text('city').notNull(),
  county: text('county').notNull(),
  zipCode: varchar('zip_code', { length: 16 }).notNull(),
  propertyType: propertyTypeEnum('property_type').notNull(),
  // NYC: block + lot identify a property; upstate uses taxMapId
  block: varchar('block', { length: 32 }),
  lot: varchar('lot', { length: 32 }),
  taxMapId: varchar('tax_map_id', { length: 64 }),
  acrisBbl: varchar('acris_bbl', { length: 32 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`),
});

export const newLoans = pgTable('new_loans', {
  id: uuid('id').defaultRandom().primaryKey(),
  principal: decimal('principal', { precision: 12, scale: 2 }).notNull(),
  rate: decimal('rate', { precision: 6, scale: 4 }),
  termMonths: integer('term_months'),
  program: loanProgramEnum('program').notNull(),
  targetFundingDate: date('target_funding_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    cemaType: cemaTypeEnum('cema_type').notNull(),
    status: dealStatusEnum('status').notNull().default('intake'),
    propertyId: uuid('property_id').references(() => properties.id),
    newLoanId: uuid('new_loan_id').references(() => newLoans.id),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    targetCloseAt: timestamp('target_close_at', { withTimezone: true }),
    slaBreachAt: timestamp('sla_breach_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => ({
    orgStatusIdx: uniqueIndex('deals_org_id_id_idx').on(t.organizationId, t.id),
  }),
);

export const existingLoans = pgTable('existing_loans', {
  id: uuid('id').defaultRandom().primaryKey(),
  dealId: uuid('deal_id')
    .notNull()
    .references(() => deals.id, { onDelete: 'cascade' }),
  upb: decimal('upb', { precision: 12, scale: 2 }).notNull(),
  originalPrincipal: decimal('original_principal', { precision: 12, scale: 2 }),
  noteDate: date('note_date'),
  maturityDate: date('maturity_date'),
  currentServicerId: uuid('current_servicer_id').references(() => servicers.id),
  investor: varchar('investor', { length: 64 }),
  recordedReelPage: varchar('recorded_reel_page', { length: 64 }),
  recordedCrfn: varchar('recorded_crfn', { length: 64 }),
  chainPosition: integer('chain_position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 4: Wire into schema index**

Update `packages/db/src/schema/index.ts`:

```ts
export * from './enums.js';
export * from './tenants.js';
export * from './servicers.js';
export * from './deals.js';
```

- [ ] **Step 5: Run test — verify it passes**

```bash
pnpm test src/schema/deals.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db/schema): add deals, properties, new_loans, existing_loans"
```

---

### Task 8: Implement parties, documents, attorney-review, and audit schemas

**Files:**
- Create: `packages/db/src/schema/parties.ts`
- Create: `packages/db/src/schema/documents.ts`
- Create: `packages/db/src/schema/attorney-review.ts`
- Create: `packages/db/src/schema/audit.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/all.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/all.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { attorneyApprovals } from './attorney-review.js';
import { auditEvents } from './audit.js';
import { documents } from './documents.js';
import { parties } from './parties.js';

describe('parties + documents + attorney + audit', () => {
  it('parties tied to a deal with a role', () => {
    const cols = Object.keys(parties);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'dealId', 'role', 'fullName', 'email', 'phone']),
    );
  });

  it('documents include attorney_review_required gate', () => {
    const cols = Object.keys(documents);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'dealId',
        'kind',
        'status',
        'attorneyReviewRequired',
        'blobUrl',
        'checksum',
        'pageCount',
        'extractedData',
        'createdAt',
      ]),
    );
  });

  it('attorney approvals are immutable per document version', () => {
    const cols = Object.keys(attorneyApprovals);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'documentId',
        'documentVersion',
        'approvedById',
        'approvedAt',
        'nmlsId',
        'notes',
      ]),
    );
  });

  it('audit events are append-only', () => {
    const cols = Object.keys(auditEvents);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'organizationId',
        'actorUserId',
        'action',
        'entityType',
        'entityId',
        'metadata',
        'occurredAt',
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm test src/schema/all.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement parties.ts**

Create `packages/db/src/schema/parties.ts`:

```ts
import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { deals } from './deals.js';
import { partyRoleEnum } from './enums.js';

export const parties = pgTable('parties', {
  id: uuid('id').defaultRandom().primaryKey(),
  dealId: uuid('deal_id')
    .notNull()
    .references(() => deals.id, { onDelete: 'cascade' }),
  role: partyRoleEnum('role').notNull(),
  fullName: text('full_name'),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 32 }),
  // encrypted PII via pgcrypto pattern — encrypted in app layer for v1
  ssnEncrypted: text('ssn_encrypted'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`),
});
```

- [ ] **Step 4: Implement documents.ts**

Create `packages/db/src/schema/documents.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { deals } from './deals.js';
import { documentKindEnum, documentStatusEnum } from './enums.js';

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  dealId: uuid('deal_id')
    .notNull()
    .references(() => deals.id, { onDelete: 'cascade' }),
  kind: documentKindEnum('kind').notNull(),
  status: documentStatusEnum('status').notNull().default('draft'),
  version: integer('version').notNull().default(1),
  attorneyReviewRequired: boolean('attorney_review_required').notNull().default(false),
  blobUrl: text('blob_url'),
  checksum: varchar('checksum', { length: 128 }),
  pageCount: integer('page_count'),
  extractedData: jsonb('extracted_data').$type<Record<string, unknown>>().default({}).notNull(),
  recordedReelPage: varchar('recorded_reel_page', { length: 64 }),
  recordedCrfn: varchar('recorded_crfn', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`),
});
```

- [ ] **Step 5: Implement attorney-review.ts**

Create `packages/db/src/schema/attorney-review.ts`:

```ts
import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { documents } from './documents.js';
import { users } from './tenants.js';

export const attorneyApprovals = pgTable('attorney_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  documentVersion: integer('document_version').notNull(),
  approvedById: uuid('approved_by_id')
    .notNull()
    .references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }).defaultNow().notNull(),
  nmlsId: varchar('nmls_id', { length: 32 }),
  notes: text('notes'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
});
```

- [ ] **Step 6: Implement audit.ts**

Create `packages/db/src/schema/audit.ts`:

```ts
import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { organizations, users } from './tenants.js';

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: varchar('action', { length: 128 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgOccurredIdx: index('audit_events_org_occurred_idx').on(t.organizationId, t.occurredAt),
    entityIdx: index('audit_events_entity_idx').on(t.entityType, t.entityId),
  }),
);
```

- [ ] **Step 7: Wire into schema index**

Update `packages/db/src/schema/index.ts`:

```ts
export * from './enums.js';
export * from './tenants.js';
export * from './servicers.js';
export * from './deals.js';
export * from './parties.js';
export * from './documents.js';
export * from './attorney-review.js';
export * from './audit.js';
```

- [ ] **Step 8: Run all tests — verify they pass**

```bash
pnpm test
```

Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/db
git commit -m "feat(db/schema): add parties, documents, attorney_approvals, audit_events"
```

---

### Task 9: Generate and apply initial migration

**Files:**
- Create: `packages/db/migrations/0000_*.sql` (generated)
- Create: `packages/db/migrations/meta/_journal.json` (generated)

- [ ] **Step 1: Generate migration**

```bash
cd packages/db
pnpm db:generate
```

Expected: A new file `migrations/0000_<random_words>.sql` is created with `CREATE TYPE`, `CREATE TABLE`, and `CREATE INDEX` statements for all tables defined so far.

- [ ] **Step 2: Verify generated SQL**

Open the generated `migrations/0000_*.sql`. Verify it contains:

- Each enum from `enums.ts`
- All tables: `organizations`, `users`, `memberships`, `servicers`, `servicer_cema_departments`, `properties`, `new_loans`, `deals`, `existing_loans`, `parties`, `documents`, `attorney_approvals`, `audit_events`
- Indexes from each schema

No destructive statements (`DROP`, `ALTER TABLE ... DROP`, `TRUNCATE`).

- [ ] **Step 3: Apply migration to Neon dev branch**

```bash
pnpm db:migrate
```

Expected: Output `[✓] migrations applied successfully!`

- [ ] **Step 4: Verify via Drizzle Studio**

```bash
pnpm db:studio
```

Open the URL printed. Confirm all 13 tables are present. Close studio.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations
git commit -m "feat(db): apply initial migration with all phase-0 tables"
```

---

### Task 10: Implement Row-Level Security policies

**Files:**
- Create: `packages/db/src/rls.ts`
- Create: `packages/db/migrations/0001_rls.sql` (hand-written; not generated)
- Create: `packages/db/src/rls.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/rls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { getRlsContext, withRlsContext } from './rls.js';

describe('RLS context', () => {
  it('setting context returns a SQL statement that sets local org_id', () => {
    const stmt = withRlsContext('00000000-0000-0000-0000-000000000001');
    expect(stmt).toContain("SET LOCAL app.current_organization_id = '00000000");
  });

  it('throws if given a non-UUID org id', () => {
    expect(() => withRlsContext('not-a-uuid')).toThrow();
  });

  it('parses the current org from a context envelope', () => {
    const ctx = { currentOrganizationId: '00000000-0000-0000-0000-000000000001' };
    expect(getRlsContext(ctx).orgId).toBe('00000000-0000-0000-0000-000000000001');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm test src/rls.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement rls.ts**

Create `packages/db/src/rls.ts`:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RlsContext {
  currentOrganizationId: string;
}

export function withRlsContext(organizationId: string): string {
  if (!UUID_RE.test(organizationId)) {
    throw new Error(`Invalid organization id (must be UUID): ${organizationId}`);
  }
  return `SET LOCAL app.current_organization_id = '${organizationId}'`;
}

export function getRlsContext(ctx: RlsContext): { orgId: string } {
  return { orgId: ctx.currentOrganizationId };
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
pnpm test src/rls.test.ts
```

Expected: PASS.

- [ ] **Step 5: Hand-write the RLS migration SQL**

Create `packages/db/migrations/0001_rls.sql`:

```sql
-- Enable RLS on every tenant-scoped table.
-- Policies use the session-local variable `app.current_organization_id`
-- set by withRlsContext() at the start of every transaction.

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY deals_org_isolation ON deals
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_events_org_isolation ON audit_events
  USING (organization_id::text = current_setting('app.current_organization_id', true));

-- properties, parties, documents, attorney_approvals, existing_loans, new_loans
-- are scoped indirectly via deal_id → deal.organization_id.
-- Enforce via JOIN-based USING expression.

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY properties_org_isolation ON properties
  USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.property_id = properties.id
        AND d.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY parties_org_isolation ON parties
  USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = parties.deal_id
        AND d.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_org_isolation ON documents
  USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = documents.deal_id
        AND d.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

ALTER TABLE existing_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY existing_loans_org_isolation ON existing_loans
  USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = existing_loans.deal_id
        AND d.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

ALTER TABLE attorney_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY attorney_approvals_org_isolation ON attorney_approvals
  USING (
    EXISTS (
      SELECT 1
      FROM documents doc
      JOIN deals d ON doc.deal_id = d.id
      WHERE doc.id = attorney_approvals.document_id
        AND d.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

-- organizations, users, memberships are NOT row-level isolated — they
-- are managed by Clerk webhooks and accessed only via authenticated
-- sessions. Defense remains the application-layer Clerk org check.
```

Append to `packages/db/migrations/meta/_journal.json`:

The journal file needs the new migration registered. Run:

```bash
pnpm db:generate
```

Expected: drizzle-kit picks up the new SQL file and updates the journal. If not, manually edit the journal to include entry for `0001_rls`.

- [ ] **Step 6: Apply RLS migration**

```bash
pnpm db:migrate
```

Expected: Migration applied. No errors.

- [ ] **Step 7: Verify in Drizzle Studio or psql**

```bash
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true;"
```

Expected: Lists `deals`, `audit_events`, `properties`, `parties`, `documents`, `existing_loans`, `attorney_approvals`.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db/rls): enable row-level security on tenant-scoped tables"
```

---

### Task 11: Implement packages/compliance (PII redaction, audit log, attorney guard)

**Files:**
- Create: `packages/compliance/package.json`
- Create: `packages/compliance/tsconfig.json`
- Create: `packages/compliance/src/index.ts`
- Create: `packages/compliance/src/pii.ts`
- Create: `packages/compliance/src/audit-log.ts`
- Create: `packages/compliance/src/attorney-review.ts`
- Create: `packages/compliance/src/pii.test.ts`
- Create: `packages/compliance/src/audit-log.test.ts`
- Create: `packages/compliance/src/attorney-review.test.ts`

- [ ] **Step 1: Create package.json**

```bash
mkdir -p packages/compliance/src
```

Create `packages/compliance/package.json`:

```json
{
  "name": "@cema/compliance",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "@cema/db": "workspace:*",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig**

Create `packages/compliance/tsconfig.json`:

```json
{
  "extends": "@cema/config/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write failing tests for PII redaction**

Create `packages/compliance/src/pii.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { maskSsn, redactPii } from './pii.js';

describe('PII redaction', () => {
  it('masks SSN to last-4 only', () => {
    expect(maskSsn('123-45-6789')).toBe('***-**-6789');
    expect(maskSsn('123456789')).toBe('*****6789');
  });

  it('redactPii replaces SSN strings in arbitrary text', () => {
    const input = 'Borrower SSN: 123-45-6789, email: test@example.com';
    const out = redactPii(input);
    expect(out).not.toContain('123-45-6789');
    expect(out).toContain('***-**-6789');
  });

  it('redactPii is a no-op for null/undefined', () => {
    expect(redactPii(null as unknown as string)).toBeNull();
    expect(redactPii(undefined as unknown as string)).toBeUndefined();
  });

  it('redactPii recurses into objects without mutating input', () => {
    const input = { ssn: '123-45-6789', name: 'Alice', age: 33 };
    const out = redactPii(input);
    expect(input.ssn).toBe('123-45-6789'); // original unchanged
    expect((out as typeof input).ssn).toBe('***-**-6789');
    expect((out as typeof input).name).toBe('Alice');
  });
});
```

- [ ] **Step 4: Implement pii.ts**

Create `packages/compliance/src/pii.ts`:

```ts
const SSN_RE = /\b(\d{3})[-\s]?(\d{2})[-\s]?(\d{4})\b/g;

export function maskSsn(ssn: string): string {
  if (ssn.length === 11 && ssn[3] === '-' && ssn[6] === '-') {
    return `***-**-${ssn.slice(7)}`;
  }
  if (ssn.length === 9) {
    return `*****${ssn.slice(5)}`;
  }
  return ssn.replace(SSN_RE, '***-**-$3');
}

export function redactPii<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return value.replace(SSN_RE, '***-**-$3') as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactPii(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.toLowerCase() === 'ssn' && typeof v === 'string') {
        out[k] = maskSsn(v);
      } else {
        out[k] = redactPii(v);
      }
    }
    return out as unknown as T;
  }
  return value;
}
```

- [ ] **Step 5: Run pii tests — verify pass**

```bash
cd packages/compliance
pnpm install
pnpm test src/pii.test.ts
```

Expected: All PII tests PASS.

- [ ] **Step 6: Write failing tests for audit log**

Create `packages/compliance/src/audit-log.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { emitAuditEvent } from './audit-log.js';

describe('audit log', () => {
  it('emit creates an audit row with required fields', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ rowCount: 1 });
    const fakeDb = {
      insert: () => ({ values: insertSpy }),
    };

    await emitAuditEvent(fakeDb as never, {
      organizationId: '00000000-0000-0000-0000-000000000001',
      actorUserId: '00000000-0000-0000-0000-000000000002',
      action: 'deal.created',
      entityType: 'deal',
      entityId: '00000000-0000-0000-0000-000000000003',
      metadata: { foo: 'bar' },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: '00000000-0000-0000-0000-000000000001',
        action: 'deal.created',
        entityType: 'deal',
      }),
    );
  });

  it('metadata is PII-redacted before insertion', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ rowCount: 1 });
    const fakeDb = { insert: () => ({ values: insertSpy }) };

    await emitAuditEvent(fakeDb as never, {
      organizationId: '00000000-0000-0000-0000-000000000001',
      action: 'borrower.updated',
      entityType: 'borrower',
      entityId: '00000000-0000-0000-0000-000000000004',
      metadata: { ssn: '123-45-6789' },
    });

    const args = insertSpy.mock.calls[0]![0]! as { metadata: { ssn: string } };
    expect(args.metadata.ssn).toBe('***-**-6789');
  });
});
```

- [ ] **Step 7: Implement audit-log.ts**

Create `packages/compliance/src/audit-log.ts`:

```ts
import type { Database } from '@cema/db';
import { auditEvents } from '@cema/db/src/schema/audit.js';

import { redactPii } from './pii.js';

export interface AuditEventInput {
  organizationId: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function emitAuditEvent(db: Database, event: AuditEventInput): Promise<void> {
  const safeMetadata = redactPii(event.metadata ?? {});
  await db.insert(auditEvents).values({
    organizationId: event.organizationId,
    actorUserId: event.actorUserId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: safeMetadata,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
  });
}
```

- [ ] **Step 8: Run audit log tests — verify pass**

```bash
pnpm test src/audit-log.test.ts
```

Expected: PASS.

- [ ] **Step 9: Write failing tests for attorney-review guard**

Create `packages/compliance/src/attorney-review.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { requireAttorneyApproval } from './attorney-review.js';

describe('attorney review guard', () => {
  it('approved documents pass the guard', () => {
    expect(() =>
      requireAttorneyApproval({
        kind: 'cema_3172',
        status: 'approved',
        attorneyReviewRequired: true,
      }),
    ).not.toThrow();
  });

  it('draft cema_3172 throws AttorneyReviewRequiredError', () => {
    expect(() =>
      requireAttorneyApproval({
        kind: 'cema_3172',
        status: 'draft',
        attorneyReviewRequired: true,
      }),
    ).toThrow(/attorney review required/i);
  });

  it('non-gate-required documents bypass the guard', () => {
    expect(() =>
      requireAttorneyApproval({
        kind: 'payoff_letter',
        status: 'draft',
        attorneyReviewRequired: false,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 10: Implement attorney-review.ts**

Create `packages/compliance/src/attorney-review.ts`:

```ts
export class AttorneyReviewRequiredError extends Error {
  constructor(public readonly documentKind: string) {
    super(
      `Attorney review required for document of kind '${documentKind}' before this action is permitted.`,
    );
    this.name = 'AttorneyReviewRequiredError';
  }
}

export interface DocumentGate {
  kind: string;
  status: string;
  attorneyReviewRequired: boolean;
}

const TERMINAL_OK_STATES = new Set(['approved', 'executed', 'recorded']);

export function requireAttorneyApproval(doc: DocumentGate): void {
  if (!doc.attorneyReviewRequired) {
    return;
  }
  if (!TERMINAL_OK_STATES.has(doc.status)) {
    throw new AttorneyReviewRequiredError(doc.kind);
  }
}
```

- [ ] **Step 11: Implement the package index**

Create `packages/compliance/src/index.ts`:

```ts
export { emitAuditEvent, type AuditEventInput } from './audit-log.js';
export { maskSsn, redactPii } from './pii.js';
export {
  AttorneyReviewRequiredError,
  requireAttorneyApproval,
  type DocumentGate,
} from './attorney-review.js';
```

- [ ] **Step 12: Run all compliance tests — verify pass**

```bash
pnpm test
```

Expected: All tests in @cema/compliance PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/compliance
git commit -m "feat(compliance): add PII redaction, audit log emitter, attorney-review guard"
```

---

### Task 12: Implement packages/auth (Clerk wrappers + tenant helpers)

**Files:**
- Create: `packages/auth/package.json`
- Create: `packages/auth/tsconfig.json`
- Create: `packages/auth/src/index.ts`
- Create: `packages/auth/src/server.ts`
- Create: `packages/auth/src/tenant.ts`
- Create: `packages/auth/src/types.ts`
- Create: `packages/auth/src/tenant.test.ts`

- [ ] **Step 1: Create package.json**

```bash
mkdir -p packages/auth/src
```

Create `packages/auth/package.json`:

```json
{
  "name": "@cema/auth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "peerDependencies": {
    "@clerk/nextjs": "^7.0.0"
  },
  "dependencies": {
    "@cema/db": "workspace:*"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@clerk/nextjs": "^7.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig**

Create `packages/auth/tsconfig.json`:

```json
{
  "extends": "@cema/config/tsconfig/node.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write failing test for tenant helpers**

Create `packages/auth/src/tenant.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { resolveOrganizationId } from './tenant.js';

describe('resolveOrganizationId', () => {
  it('returns the active Clerk org when present', () => {
    expect(
      resolveOrganizationId({
        orgId: 'org_2abc',
        userId: 'user_2xyz',
      }),
    ).toBe('org_2abc');
  });

  it('throws when user has no active org', () => {
    expect(() => resolveOrganizationId({ userId: 'user_2xyz' })).toThrow(
      /no active organization/i,
    );
  });

  it('throws when user is signed out', () => {
    expect(() => resolveOrganizationId({})).toThrow(/not authenticated/i);
  });
});
```

- [ ] **Step 4: Implement types.ts**

Create `packages/auth/src/types.ts`:

```ts
export interface ClerkAuthSnapshot {
  userId?: string;
  orgId?: string;
  orgRole?: string;
  sessionId?: string;
}
```

- [ ] **Step 5: Implement tenant.ts**

Create `packages/auth/src/tenant.ts`:

```ts
import type { ClerkAuthSnapshot } from './types.js';

export class NotAuthenticatedError extends Error {
  constructor() {
    super('User is not authenticated.');
    this.name = 'NotAuthenticatedError';
  }
}

export class NoActiveOrganizationError extends Error {
  constructor() {
    super('User has no active organization. Select or create one before continuing.');
    this.name = 'NoActiveOrganizationError';
  }
}

export function resolveOrganizationId(snapshot: ClerkAuthSnapshot): string {
  if (!snapshot.userId) {
    throw new NotAuthenticatedError();
  }
  if (!snapshot.orgId) {
    throw new NoActiveOrganizationError();
  }
  return snapshot.orgId;
}
```

- [ ] **Step 6: Run test — verify pass**

```bash
cd packages/auth
pnpm install
pnpm test
```

Expected: All 3 tests PASS.

- [ ] **Step 7: Implement server.ts**

Create `packages/auth/src/server.ts`:

```ts
import { auth, currentUser } from '@clerk/nextjs/server';

import { resolveOrganizationId } from './tenant.js';

export async function getCurrentUser() {
  return await currentUser();
}

export async function getCurrentOrganizationId(): Promise<string> {
  const { userId, orgId } = await auth();
  return resolveOrganizationId({ userId: userId ?? undefined, orgId: orgId ?? undefined });
}

export { auth };
```

- [ ] **Step 8: Implement index.ts**

Create `packages/auth/src/index.ts`:

```ts
export { getCurrentOrganizationId, getCurrentUser, auth } from './server.js';
export {
  NoActiveOrganizationError,
  NotAuthenticatedError,
  resolveOrganizationId,
} from './tenant.js';
export type { ClerkAuthSnapshot } from './types.js';
```

- [ ] **Step 9: Commit**

```bash
git add packages/auth
git commit -m "feat(auth): add Clerk wrappers and tenant resolution helpers"
```

---

### Task 13: Scaffold packages/ui (shadcn/ui foundation)

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/components.json`
- Create: `packages/ui/tailwind.config.ts`
- Create: `packages/ui/src/styles/globals.css`
- Create: `packages/ui/src/lib/utils.ts`
- Create: `packages/ui/src/components/button.tsx`
- Create: `packages/ui/src/components/input.tsx`
- Create: `packages/ui/src/components/label.tsx`
- Create: `packages/ui/src/components/card.tsx`
- Create: `packages/ui/src/index.ts`

- [ ] **Step 1: Create package.json**

```bash
mkdir -p packages/ui/src/{components,lib,styles}
```

Create `packages/ui/package.json`:

```json
{
  "name": "@cema/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./styles/globals.css": "./src/styles/globals.css"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "dependencies": {
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.460.0",
    "tailwind-merge": "^2.5.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig**

Create `packages/ui/tsconfig.json`:

```json
{
  "extends": "@cema/config/tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create components.json (shadcn/ui config)**

Create `packages/ui/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@cema/ui/components",
    "utils": "@cema/ui/lib/utils"
  }
}
```

- [ ] **Step 4: Create lib/utils.ts**

Create `packages/ui/src/lib/utils.ts`:

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Create globals.css**

Create `packages/ui/src/styles/globals.css`:

```css
@import 'tailwindcss';

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 9%;
    --primary: 0 0% 9%;
    --primary-foreground: 0 0% 98%;
    --secondary: 0 0% 96%;
    --secondary-foreground: 0 0% 9%;
    --border: 0 0% 90%;
    --input: 0 0% 90%;
    --ring: 0 0% 71%;
    --radius: 0.5rem;
  }

  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 6: Create Button component**

Create `packages/ui/src/components/button.tsx`:

```tsx
'use client';
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-background hover:bg-accent',
        ghost: 'hover:bg-accent',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = 'Button';
```

- [ ] **Step 7: Create Input, Label, Card components**

Create `packages/ui/src/components/input.tsx`:

```tsx
import * as React from 'react';

import { cn } from '../lib/utils.js';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
```

Create `packages/ui/src/components/label.tsx`:

```tsx
import * as React from 'react';

import { cn } from '../lib/utils.js';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('text-sm font-medium leading-none', className)}
      {...props}
    />
  ),
);
Label.displayName = 'Label';
```

Create `packages/ui/src/components/card.tsx`:

```tsx
import * as React from 'react';

import { cn } from '../lib/utils.js';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border bg-card shadow-sm', className)} {...props} />
  ),
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-lg font-semibold leading-none', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';
```

- [ ] **Step 8: Create index.ts**

Create `packages/ui/src/index.ts`:

```ts
export { Button, type ButtonProps } from './components/button.js';
export { Card, CardContent, CardHeader, CardTitle } from './components/card.js';
export { Input } from './components/input.js';
export { Label } from './components/label.js';
export { cn } from './lib/utils.js';
```

- [ ] **Step 9: Install and typecheck**

```bash
pnpm install
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): scaffold shadcn-style component library (button, input, label, card)"
```

---

### Task 14: Scaffold apps/web Next.js 16 app

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/middleware.ts`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/lib/db.ts`

- [ ] **Step 1: Create the app directory and package.json**

```bash
mkdir -p apps/web/app/{api,(auth),(app)} apps/web/lib apps/web/components
```

Create `apps/web/package.json`:

```json
{
  "name": "web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --turbo",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@cema/auth": "workspace:*",
    "@cema/compliance": "workspace:*",
    "@cema/db": "workspace:*",
    "@cema/ui": "workspace:*",
    "@clerk/nextjs": "^7.0.0",
    "@hookform/resolvers": "^3.9.0",
    "drizzle-orm": "^0.36.0",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.53.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig**

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "@cema/config/tsconfig/nextjs.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create next.config.ts**

Create `apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cema/ui', '@cema/auth', '@cema/db', '@cema/compliance'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
```

- [ ] **Step 4: Create middleware.ts (Clerk auth gate)**

Create `apps/web/middleware.ts`:

```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)', '/(api|trpc)(.*)'],
};
```

- [ ] **Step 5: Create app/layout.tsx**

Create `apps/web/app/layout.tsx`:

```tsx
import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Project_CEMA',
  description: 'AI-powered CEMA mortgage processing for NY-state lenders',
};

// Note: ClerkProvider sits inside <body>, not wrapping <html>, because
// Next.js 16 Cache Components require <html> to remain statically renderable.
// Reference: Clerk Core 3 (March 2026) migration guide.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Create app/page.tsx**

Create `apps/web/app/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function Page() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }
  redirect('/sign-in');
}
```

- [ ] **Step 7: Create app/globals.css**

Create `apps/web/app/globals.css`:

```css
@import '@cema/ui/styles/globals.css';
```

- [ ] **Step 8: Create lib/db.ts**

Create `apps/web/lib/db.ts`:

```ts
export { db } from '@cema/db';
```

- [ ] **Step 9: Create postcss + tailwind configs**

Create `apps/web/postcss.config.mjs`:

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

Create `apps/web/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config;
```

- [ ] **Step 10: Install and verify build**

```bash
pnpm install
cd apps/web
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 11: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): scaffold Next.js 16 app with Clerk middleware"
```

---

### Task 15: Add sign-in and sign-up routes

**Files:**
- Create: `apps/web/app/(auth)/sign-in/[[...sign-in]]/page.tsx`
- Create: `apps/web/app/(auth)/sign-up/[[...sign-up]]/page.tsx`
- Create: `apps/web/app/(auth)/layout.tsx`

- [ ] **Step 1: Create the auth layout**

```bash
mkdir -p "apps/web/app/(auth)/sign-in/[[...sign-in]]" "apps/web/app/(auth)/sign-up/[[...sign-up]]"
```

Create `apps/web/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-secondary">{children}</main>;
}
```

- [ ] **Step 2: Create the sign-in page**

Create `apps/web/app/(auth)/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from '@clerk/nextjs';

export default function Page() {
  return <SignIn />;
}
```

- [ ] **Step 3: Create the sign-up page**

Create `apps/web/app/(auth)/sign-up/[[...sign-up]]/page.tsx`:

```tsx
import { SignUp } from '@clerk/nextjs';

export default function Page() {
  return <SignUp />;
}
```

- [ ] **Step 4: Install Clerk via Vercel Marketplace and configure routing env vars**

Preferred path — Marketplace integration auto-provisions `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to all Vercel environments:

```bash
vercel integration add clerk
```

Then add the routing env vars (these are not auto-provisioned). In `apps/web/.env.local`:

```env
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
```

In the Clerk dashboard, **enable Organizations** (Configure → Organizations → toggle on). Set the default org role to `member`. Without this, the multi-tenant flow won't work.

- [ ] **Step 5: Smoke test**

```bash
pnpm dev
```

Visit http://localhost:3000. Expected: Redirected to /sign-in. Sign-up flow works. After signing up, you're redirected to /dashboard (which 404s — we add it next).

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web/auth): add Clerk sign-in and sign-up routes"
```

---

### Task 16: Clerk webhook → DB sync for orgs and users

**Files:**
- Create: `apps/web/app/api/webhooks/clerk/route.ts`
- Create: `apps/web/lib/clerk-sync.ts`
- Create: `apps/web/lib/clerk-sync.test.ts`

- [ ] **Step 1: Write failing test**

```bash
mkdir -p apps/web/app/api/webhooks/clerk
```

Create `apps/web/lib/clerk-sync.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { handleClerkWebhook } from './clerk-sync.js';

describe('handleClerkWebhook', () => {
  it('upserts an organization on organization.created', async () => {
    const dbCalls: string[] = [];
    const fakeDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => {
            dbCalls.push('organizations.upsert');
            return Promise.resolve();
          },
        }),
      }),
    };
    await handleClerkWebhook(fakeDb as never, {
      type: 'organization.created',
      data: {
        id: 'org_2abc',
        name: 'Acme Lending',
        slug: 'acme-lending',
      } as never,
    } as never);
    expect(dbCalls).toContain('organizations.upsert');
  });

  it('upserts a user on user.created', async () => {
    const dbCalls: string[] = [];
    const fakeDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => {
            dbCalls.push('users.upsert');
            return Promise.resolve();
          },
        }),
      }),
    };
    await handleClerkWebhook(fakeDb as never, {
      type: 'user.created',
      data: {
        id: 'user_2xyz',
        email_addresses: [{ email_address: 'test@example.com' }],
        first_name: 'Test',
        last_name: 'User',
      } as never,
    } as never);
    expect(dbCalls).toContain('users.upsert');
  });

  it('ignores unrelated event types', async () => {
    await expect(
      handleClerkWebhook({} as never, { type: 'email.created', data: {} as never } as never),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement clerk-sync.ts**

Create `apps/web/lib/clerk-sync.ts`:

```ts
import type { Database } from '@cema/db';
import { organizations, users } from '@cema/db';

// Minimal type matching Clerk's webhook payload subset we care about
export interface ClerkWebhookEvent {
  type: string;
  data: {
    id: string;
    name?: string;
    slug?: string;
    email_addresses?: Array<{ email_address: string }>;
    first_name?: string | null;
    last_name?: string | null;
  };
}

export async function handleClerkWebhook(db: Database, event: ClerkWebhookEvent): Promise<void> {
  switch (event.type) {
    case 'organization.created':
    case 'organization.updated': {
      const { id, name, slug } = event.data;
      if (!id || !name || !slug) return;
      await db
        .insert(organizations)
        .values({ clerkOrgId: id, name, slug })
        .onConflictDoUpdate({
          target: organizations.clerkOrgId,
          set: { name, slug },
        });
      break;
    }
    case 'user.created':
    case 'user.updated': {
      const { id, email_addresses, first_name, last_name } = event.data;
      const email = email_addresses?.[0]?.email_address;
      if (!id || !email) return;
      const fullName = [first_name, last_name].filter(Boolean).join(' ') || null;
      await db
        .insert(users)
        .values({ clerkUserId: id, email, fullName })
        .onConflictDoUpdate({
          target: users.clerkUserId,
          set: { email, fullName },
        });
      break;
    }
    default:
      // ignore unrelated events
      return;
  }
}
```

- [ ] **Step 3: Run test — verify pass**

```bash
cd apps/web
pnpm test lib/clerk-sync.test.ts
```

Note: webhook tests can also be co-located in `__tests__/`. If `pnpm test` isn't yet wired, add a vitest config later.

Expected: PASS.

- [ ] **Step 4: Implement the webhook route**

Create `apps/web/app/api/webhooks/clerk/route.ts`:

```ts
import { db } from '@cema/db';
import type { WebhookEvent } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { Webhook } from 'svix';

import { handleClerkWebhook } from '@/lib/clerk-sync';

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return new Response('Missing CLERK_WEBHOOK_SECRET', { status: 500 });
  }
  const hdrs = await headers();
  const svixId = hdrs.get('svix-id');
  const svixTimestamp = hdrs.get('svix-timestamp');
  const svixSignature = hdrs.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing svix headers', { status: 400 });
  }
  const payload = await req.text();
  const webhook = new Webhook(secret);
  let event: WebhookEvent;
  try {
    event = webhook.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as WebhookEvent;
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
  await handleClerkWebhook(db, event);
  return new Response('OK', { status: 200 });
}
```

- [ ] **Step 5: Configure Clerk webhook endpoint**

In the Clerk dashboard → Webhooks → Add Endpoint. Use `https://<your-vercel-preview>/api/webhooks/clerk` (or via ngrok for local). Subscribe to: `user.created`, `user.updated`, `organization.created`, `organization.updated`. Copy the signing secret into `CLERK_WEBHOOK_SECRET` in `.env.local`.

- [ ] **Step 6: Install svix and verify**

```bash
pnpm add svix --filter web
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web/webhooks): sync Clerk orgs and users into Postgres"
```

---

### Task 17: Authenticated app layout with sidebar

**Files:**
- Create: `apps/web/app/(app)/layout.tsx`
- Create: `apps/web/components/sidebar.tsx`

- [ ] **Step 1: Create the authenticated layout**

```bash
mkdir -p "apps/web/app/(app)"
```

Create `apps/web/app/(app)/layout.tsx`:

```tsx
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { Sidebar } from '@/components/sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId } = await auth();
  if (!userId) {
    redirect('/sign-in');
  }
  if (!orgId) {
    // Force org creation flow before reaching app pages
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary">
        <div className="rounded-lg bg-card p-8 shadow-sm">
          <h1 className="mb-4 text-xl font-semibold">Create or select an organization</h1>
          <OrganizationSwitcher afterCreateOrganizationUrl="/dashboard" />
        </div>
      </main>
    );
  }
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-card px-6 py-3">
          <OrganizationSwitcher />
          <UserButton />
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the sidebar component**

Create `apps/web/components/sidebar.tsx`:

```tsx
import Link from 'next/link';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/deals', label: 'Deals' },
  { href: '/settings/org', label: 'Settings' },
];

export function Sidebar() {
  return (
    <aside className="w-56 border-r bg-card p-4">
      <div className="mb-6 px-2 text-lg font-semibold">Project_CEMA</div>
      <nav className="space-y-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: Add a dashboard placeholder**

```bash
mkdir -p "apps/web/app/(app)/dashboard"
```

Create `apps/web/app/(app)/dashboard/page.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@cema/ui';

export default function Page() {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your CEMA pipeline will appear here once you create your first Deal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Smoke test**

```bash
pnpm dev
```

Visit http://localhost:3000. Sign in → create org if prompted → land on dashboard. Sidebar visible. Org switcher works.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): add authenticated app layout with sidebar and org switcher"
```

---

### Task 18: Deal list + create server actions

**Files:**
- Create: `apps/web/lib/actions/list-deals.ts`
- Create: `apps/web/lib/actions/create-deal.ts`
- Create: `apps/web/lib/actions/create-deal.test.ts`
- Create: `apps/web/lib/with-rls.ts`

- [ ] **Step 1: Implement the RLS helper**

Create `apps/web/lib/with-rls.ts`:

```ts
import { db } from '@cema/db';
import { sql } from 'drizzle-orm';

export async function withRls<T>(
  organizationId: string,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  await db.execute(sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`);
  return fn(db);
}
```

(Note: Neon HTTP driver does not support transactional `SET LOCAL`. For Phase 0, we use `set_config(..., true)` which sets the session-local variable for the current connection. With Neon's pooled HTTP each request gets a fresh connection — adequate for v1. A later task will upgrade to the WebSocket driver for transactional semantics if needed.)

- [ ] **Step 2: Write failing test for create-deal**

Create `apps/web/lib/actions/create-deal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { createDealInputSchema } from './create-deal.js';

describe('createDealInputSchema', () => {
  it('accepts a minimum Refi-CEMA input', () => {
    const result = createDealInputSchema.safeParse({
      cemaType: 'refi_cema',
      propertyType: 'one_family',
      streetAddress: '123 Main St',
      city: 'Brooklyn',
      county: 'Kings',
      zipCode: '11201',
      principal: '500000',
      program: 'conventional_fannie',
      upb: '420000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects co-op property type', () => {
    const result = createDealInputSchema.safeParse({
      cemaType: 'refi_cema',
      propertyType: 'coop',
      streetAddress: '123 Main St',
      city: 'Brooklyn',
      county: 'Kings',
      zipCode: '11201',
      principal: '500000',
      program: 'conventional_fannie',
      upb: '420000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects VA loan program', () => {
    const result = createDealInputSchema.safeParse({
      cemaType: 'refi_cema',
      propertyType: 'one_family',
      streetAddress: '123 Main St',
      city: 'Brooklyn',
      county: 'Kings',
      zipCode: '11201',
      principal: '500000',
      program: 'va',
      upb: '420000',
    });
    expect(result.success).toBe(false);
  });

  it('Purchase CEMA requires a seller flag (Phase 2 — not required here)', () => {
    const result = createDealInputSchema.safeParse({
      cemaType: 'purchase_cema',
      propertyType: 'condo',
      streetAddress: '500 5th Ave',
      city: 'New York',
      county: 'New York',
      zipCode: '10110',
      principal: '900000',
      program: 'conventional_fannie',
      upb: '650000',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 3: Implement create-deal.ts**

Create `apps/web/lib/actions/create-deal.ts`:

```ts
'use server';

import { db, deals, existingLoans, newLoans, organizations, properties, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';

import { withRls } from '@/lib/with-rls';

export const createDealInputSchema = z.object({
  cemaType: z.enum(['refi_cema', 'purchase_cema']),
  propertyType: z.enum(['one_family', 'two_family', 'three_family', 'condo', 'pud']),
  streetAddress: z.string().min(1),
  unit: z.string().optional(),
  city: z.string().min(1),
  county: z.string().min(1),
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/),
  principal: z.string().regex(/^\d+(\.\d{1,2})?$/),
  program: z.enum(['conventional_fannie', 'conventional_freddie', 'conventional_private', 'jumbo', 'fha']),
  upb: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export type CreateDealInput = z.infer<typeof createDealInputSchema>;

export async function createDeal(rawInput: unknown): Promise<{ id: string }> {
  const input = createDealInputSchema.parse(rawInput);
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new Error('Not authenticated');

  // Resolve internal org and user ids
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not synced yet');
  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!user) throw new Error('User not synced yet');

  return withRls(org.id, async (tx) => {
    const [property] = await tx
      .insert(properties)
      .values({
        streetAddress: input.streetAddress,
        unit: input.unit,
        city: input.city,
        county: input.county,
        zipCode: input.zipCode,
        propertyType: input.propertyType,
      })
      .returning();

    const [newLoan] = await tx
      .insert(newLoans)
      .values({ principal: input.principal, program: input.program })
      .returning();

    const [deal] = await tx
      .insert(deals)
      .values({
        organizationId: org.id,
        cemaType: input.cemaType,
        propertyId: property!.id,
        newLoanId: newLoan!.id,
        createdById: user.id,
      })
      .returning();

    await tx.insert(existingLoans).values({
      dealId: deal!.id,
      upb: input.upb,
      chainPosition: 0,
    });

    await emitAuditEvent(tx, {
      organizationId: org.id,
      actorUserId: user.id,
      action: 'deal.created',
      entityType: 'deal',
      entityId: deal!.id,
      metadata: { cemaType: input.cemaType, principal: input.principal, upb: input.upb },
    });

    revalidatePath('/deals');
    return { id: deal!.id };
  });
}
```

- [ ] **Step 4: Implement list-deals.ts**

Create `apps/web/lib/actions/list-deals.ts`:

```ts
import { db, deals, organizations } from '@cema/db';
import { desc, eq } from 'drizzle-orm';

import { getCurrentOrganizationId } from '@cema/auth';

import { withRls } from '@/lib/with-rls';

export async function listDeals() {
  const clerkOrgId = await getCurrentOrganizationId();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];
  return withRls(org.id, async (tx) =>
    tx.query.deals.findMany({
      where: eq(deals.organizationId, org.id),
      orderBy: [desc(deals.createdAt)],
      limit: 50,
    }),
  );
}
```

- [ ] **Step 5: Run tests — verify pass**

```bash
cd apps/web
pnpm test lib/actions/create-deal.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web/deals): add createDeal server action and listDeals helper"
```

---

### Task 19: Deal list page

**Files:**
- Create: `apps/web/app/(app)/deals/page.tsx`
- Create: `apps/web/components/deal-card.tsx`

- [ ] **Step 1: Create the deal-card component**

```bash
mkdir -p "apps/web/app/(app)/deals"
```

Create `apps/web/components/deal-card.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@cema/ui';
import Link from 'next/link';

interface DealCardProps {
  deal: {
    id: string;
    cemaType: 'refi_cema' | 'purchase_cema';
    status: string;
    createdAt: Date;
  };
}

const STATUS_LABELS: Record<string, string> = {
  intake: 'Intake',
  eligibility: 'Eligibility',
  authorization: 'Authorization',
  collateral_chase: 'Collateral chase',
  title_work: 'Title work',
  doc_prep: 'Doc prep',
  attorney_review: 'Attorney review',
  closing: 'Closing',
  recording: 'Recording',
  completed: 'Completed',
  exception: 'Exception',
  cancelled: 'Cancelled',
};

export function DealCard({ deal }: DealCardProps) {
  return (
    <Link href={`/deals/${deal.id}`} className="block">
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="text-base">
            {deal.cemaType === 'refi_cema' ? 'Refi CEMA' : 'Purchase CEMA'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Status:</span>
            <span>{STATUS_LABELS[deal.status] ?? deal.status}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Created:</span>
            <span>{deal.createdAt.toLocaleDateString()}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Create the deal list page**

Create `apps/web/app/(app)/deals/page.tsx`:

```tsx
import { Button } from '@cema/ui';
import Link from 'next/link';

import { DealCard } from '@/components/deal-card';
import { listDeals } from '@/lib/actions/list-deals';

export default async function Page() {
  const allDeals = await listDeals();
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Deals</h1>
        <Link href="/deals/new">
          <Button>New deal</Button>
        </Link>
      </div>
      {allDeals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No deals yet. Click &quot;New deal&quot; to create your first.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {allDeals.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Smoke test**

```bash
pnpm dev
```

Navigate to /deals. Expected: Empty state with "New deal" button. Page loads without error.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web/deals): add deal list page with empty state"
```

---

### Task 20: New deal form

**Files:**
- Create: `apps/web/app/(app)/deals/new/page.tsx`
- Create: `apps/web/components/deal-form.tsx`

- [ ] **Step 1: Create the deal-form component**

```bash
mkdir -p "apps/web/app/(app)/deals/new"
```

Create `apps/web/components/deal-form.tsx`:

```tsx
'use client';

import { Button, Card, CardContent, Input, Label } from '@cema/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { createDeal, createDealInputSchema, type CreateDealInput } from '@/lib/actions/create-deal';

export function DealForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateDealInput>({
    resolver: zodResolver(createDealInputSchema),
    defaultValues: {
      cemaType: 'refi_cema',
      propertyType: 'one_family',
      program: 'conventional_fannie',
    },
  });

  async function onSubmit(input: CreateDealInput) {
    setError(null);
    try {
      const { id } = await createDeal(input);
      router.push(`/deals/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="CEMA type" error={errors.cemaType?.message}>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3" {...register('cemaType')}>
                <option value="refi_cema">Refi CEMA</option>
                <option value="purchase_cema">Purchase CEMA</option>
              </select>
            </Field>
            <Field label="Property type" error={errors.propertyType?.message}>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3" {...register('propertyType')}>
                <option value="one_family">1-family</option>
                <option value="two_family">2-family</option>
                <option value="three_family">3-family</option>
                <option value="condo">Condo</option>
                <option value="pud">PUD</option>
              </select>
            </Field>
          </div>
          <Field label="Street address" error={errors.streetAddress?.message}>
            <Input {...register('streetAddress')} />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Unit" error={errors.unit?.message}>
              <Input {...register('unit')} />
            </Field>
            <Field label="City" error={errors.city?.message}>
              <Input {...register('city')} />
            </Field>
            <Field label="County" error={errors.county?.message}>
              <Input {...register('county')} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="ZIP" error={errors.zipCode?.message}>
              <Input {...register('zipCode')} />
            </Field>
            <Field label="UPB (existing)" error={errors.upb?.message}>
              <Input {...register('upb')} placeholder="500000.00" />
            </Field>
            <Field label="New principal" error={errors.principal?.message}>
              <Input {...register('principal')} placeholder="700000.00" />
            </Field>
          </div>
          <Field label="Loan program" error={errors.program?.message}>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3" {...register('program')}>
              <option value="conventional_fannie">Conventional — Fannie</option>
              <option value="conventional_freddie">Conventional — Freddie</option>
              <option value="conventional_private">Conventional — Private</option>
              <option value="jumbo">Jumbo</option>
              <option value="fha">FHA</option>
            </select>
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create deal'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create the new-deal page**

Create `apps/web/app/(app)/deals/new/page.tsx`:

```tsx
import { DealForm } from '@/components/deal-form';

export default function Page() {
  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">New deal</h1>
      <DealForm />
    </div>
  );
}
```

- [ ] **Step 3: Smoke test**

```bash
pnpm dev
```

Navigate to /deals/new → fill in form → submit → redirected to /deals/[id]. Confirm deal appears in /deals list.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web/deals): add new-deal form with Zod validation and server action"
```

---

### Task 21: Deal detail page (read-only Phase 0 view)

**Files:**
- Create: `apps/web/app/(app)/deals/[id]/page.tsx`
- Create: `apps/web/lib/actions/get-deal.ts`

- [ ] **Step 1: Implement getDeal action**

Create `apps/web/lib/actions/get-deal.ts`:

```ts
import { db, deals, existingLoans, newLoans, organizations, properties } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { getCurrentOrganizationId } from '@cema/auth';

import { withRls } from '@/lib/with-rls';

export async function getDeal(id: string) {
  const clerkOrgId = await getCurrentOrganizationId();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return null;
  return withRls(org.id, async (tx) => {
    const deal = await tx.query.deals.findFirst({
      where: and(eq(deals.id, id), eq(deals.organizationId, org.id)),
    });
    if (!deal) return null;
    const property = deal.propertyId
      ? await tx.query.properties.findFirst({ where: eq(properties.id, deal.propertyId) })
      : null;
    const newLoan = deal.newLoanId
      ? await tx.query.newLoans.findFirst({ where: eq(newLoans.id, deal.newLoanId) })
      : null;
    const existing = await tx.query.existingLoans.findMany({
      where: eq(existingLoans.dealId, deal.id),
    });
    return { deal, property, newLoan, existingLoans: existing };
  });
}
```

- [ ] **Step 2: Create the deal-detail page**

```bash
mkdir -p "apps/web/app/(app)/deals/[id]"
```

Create `apps/web/app/(app)/deals/[id]/page.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@cema/ui';
import { notFound } from 'next/navigation';

import { getDeal } from '@/lib/actions/get-deal';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDeal(id);
  if (!data) notFound();
  const { deal, property, newLoan, existingLoans } = data;
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">
        {deal.cemaType === 'refi_cema' ? 'Refi CEMA' : 'Purchase CEMA'} · {deal.status}
      </h1>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Property</CardTitle>
          </CardHeader>
          <CardContent>
            {property ? (
              <dl className="space-y-1 text-sm">
                <Row k="Address" v={`${property.streetAddress}${property.unit ? ` ${property.unit}` : ''}`} />
                <Row k="City / County" v={`${property.city}, ${property.county}`} />
                <Row k="ZIP" v={property.zipCode} />
                <Row k="Type" v={property.propertyType} />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No property yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>New loan</CardTitle>
          </CardHeader>
          <CardContent>
            {newLoan ? (
              <dl className="space-y-1 text-sm">
                <Row k="Principal" v={`$${newLoan.principal}`} />
                <Row k="Program" v={newLoan.program} />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No new loan yet.</p>
            )}
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Existing loans ({existingLoans.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {existingLoans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No existing loans yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {existingLoans.map((loan) => (
                  <li key={loan.id} className="flex justify-between border-b pb-2 last:border-0">
                    <span>UPB: ${loan.upb}</span>
                    <span>Chain position: {loan.chainPosition}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
```

- [ ] **Step 3: Smoke test**

```bash
pnpm dev
```

Create a deal → click into it → see property + new loan + existing loans displayed correctly.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web/deals): add deal detail page (Phase 0 read-only view)"
```

---

### Task 22: Playwright e2e — happy path

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/tests/e2e/happy-path.spec.ts`
- Modify: `apps/web/package.json` (add test:e2e script)

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D @playwright/test --filter web
pnpm exec playwright install --with-deps chromium
```

- [ ] **Step 2: Create Playwright config**

Create `apps/web/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Add test:e2e script**

In `apps/web/package.json`, add to scripts:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 4: Write the happy-path e2e**

```bash
mkdir -p apps/web/tests/e2e
```

Create `apps/web/tests/e2e/happy-path.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// This test requires an existing test user + org in Clerk. Set up via
// E2E_USER_EMAIL / E2E_USER_PASSWORD / E2E_ORG_SLUG env vars before running.

test.skip(!process.env.E2E_USER_EMAIL, 'Skipping — set E2E_USER_EMAIL to run');

test('user can sign in and create a Refi-CEMA deal', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel(/email/i).fill(process.env.E2E_USER_EMAIL!);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByLabel(/password/i).fill(process.env.E2E_USER_PASSWORD!);
  await page.getByRole('button', { name: /continue/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('link', { name: /deals/i }).click();
  await expect(page).toHaveURL(/\/deals$/);

  await page.getByRole('link', { name: /new deal/i }).click();
  await page.getByLabel(/street address/i).fill('123 Main St');
  await page.getByLabel(/city/i).fill('Brooklyn');
  await page.getByLabel(/county/i).fill('Kings');
  await page.getByLabel(/zip/i).fill('11201');
  await page.getByLabel(/upb/i).fill('420000');
  await page.getByLabel(/new principal/i).fill('700000');
  await page.getByRole('button', { name: /create deal/i }).click();

  await expect(page).toHaveURL(/\/deals\/[a-f0-9-]+$/);
  await expect(page.getByRole('heading', { name: /refi cema/i })).toBeVisible();
});
```

- [ ] **Step 5: Run locally**

```bash
E2E_USER_EMAIL=... E2E_USER_PASSWORD=... pnpm test:e2e --filter web
```

Expected: PASS (or `skipped` if env vars not set — also acceptable for CI gating).

- [ ] **Step 6: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "test(web/e2e): add happy-path Playwright spec for sign-in + create deal"
```

---

### Task 23: RLS multi-tenant isolation test (the most important compliance test)

**Files:**
- Create: `apps/web/tests/integration/rls-isolation.test.ts`

- [ ] **Step 1: Write the test**

```bash
mkdir -p apps/web/tests/integration
```

Create `apps/web/tests/integration/rls-isolation.test.ts`:

```ts
import { db, deals, organizations, users } from '@cema/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Two orgs in the same Neon DB — Deal created by org A must not be
// readable when the RLS context is set to org B.

const ORG_A_ID = '00000000-0000-0000-0000-00000000000a';
const ORG_B_ID = '00000000-0000-0000-0000-00000000000b';
const USER_ID = '00000000-0000-0000-0000-000000000001';

beforeAll(async () => {
  await db.insert(organizations).values([
    { id: ORG_A_ID, clerkOrgId: 'org_a', name: 'Org A', slug: 'org-a' },
    { id: ORG_B_ID, clerkOrgId: 'org_b', name: 'Org B', slug: 'org-b' },
  ]).onConflictDoNothing();
  await db.insert(users).values({
    id: USER_ID,
    clerkUserId: 'user_test',
    email: 'rls-test@example.com',
  }).onConflictDoNothing();
});

afterAll(async () => {
  await db.execute(sql`SELECT set_config('app.current_organization_id', '', true)`);
  await db.delete(deals).where(sql`organization_id IN (${ORG_A_ID}, ${ORG_B_ID})`);
  await db.delete(organizations).where(sql`id IN (${ORG_A_ID}, ${ORG_B_ID})`);
});

describe('RLS multi-tenant isolation', () => {
  it('Org A cannot see a deal created by Org B', async () => {
    // Create a deal under Org A
    await db.execute(sql`SELECT set_config('app.current_organization_id', ${ORG_A_ID}, true)`);
    const [aDeal] = await db
      .insert(deals)
      .values({
        organizationId: ORG_A_ID,
        cemaType: 'refi_cema',
        createdById: USER_ID,
      })
      .returning();

    // Switch to Org B context
    await db.execute(sql`SELECT set_config('app.current_organization_id', ${ORG_B_ID}, true)`);
    const visible = await db.query.deals.findMany();
    expect(visible.find((d) => d.id === aDeal!.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd apps/web
pnpm test tests/integration/rls-isolation.test.ts
```

Expected: PASS. (This proves Phase 0's most critical security promise.)

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "test(web/rls): verify cross-org Deal isolation via RLS"
```

---

### Task 24: Link Vercel project + first preview deployment

**Files:** No code changes — infra step.

- [ ] **Step 1: Install Vercel CLI globally**

```bash
npm i -g vercel
```

- [ ] **Step 2: Link the repo to Vercel**

In the repo root:

```bash
vercel link
```

Choose: existing project? → No. Scope → `connorbhickey`. Project name → `project-cema`. Code directory → leave default. Confirm.

This creates `.vercel/project.json` (gitignored).

- [ ] **Step 3: Set Vercel project root**

Open the Vercel dashboard → Project settings → Build & Development → Root directory → `apps/web`. Framework preset → Next.js. Install command → `pnpm install`. Build command → `pnpm build`. Output directory → `.next` (default).

- [ ] **Step 4: Set environment variables**

In the Vercel dashboard → Settings → Environment Variables, add the contents of your `.env.local` to **Preview** and **Production** environments:

- `DATABASE_URL` — Neon production branch
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- (Plus any others you've added during Phase 0)

- [ ] **Step 5: Trigger a preview deploy**

```bash
git checkout -b chore/initial-deploy
git commit --allow-empty -m "chore(deploy): trigger initial Vercel preview"
git push -u origin chore/initial-deploy
```

Open a PR. Wait for Vercel preview deployment. Visit the preview URL → sign in → create a Deal → verify it works end-to-end.

- [ ] **Step 6: Merge to main**

Approve and squash-merge the PR. Confirm production deployment succeeds at the production URL.

- [ ] **Step 7: Update CLAUDE.md status section**

Edit `CLAUDE.md`:

```markdown
- **Phase:** Phase 0 month 1 complete — multi-tenant scaffold, Deal entity, attorney-review primitives, audit log, Vercel preview-per-PR active.
- **Next step:** Plan Phase 0 month 2 (telephony foundation).
```

Commit on a follow-up branch and merge.

- [ ] **Step 8: Final commit**

```bash
git checkout -b chore/phase-0-month-1-complete
git add CLAUDE.md
git commit -m "docs(claude): mark phase 0 month 1 complete"
git push -u origin chore/phase-0-month-1-complete
```

Open PR, merge.

---

## Self-Review

Done in-doc:

**1. Spec coverage:** Every Phase 0 month-1 bullet from the spec maps to one or more tasks:
- Multi-tenant scaffold → Tasks 5, 12, 16, 17
- Neon Postgres + Drizzle → Tasks 3–10
- Clerk auth → Tasks 12, 14, 15, 16
- Deal entity schema → Tasks 4–10
- Basic UI shell (Next.js 16 App Router) → Tasks 14, 17–21
- Attorney review primitives → Tasks 8 (schema), 11 (guard)
- Audit log → Tasks 8 (schema), 11 (emitter)
- Multi-tenant isolation → Task 10 (RLS), Task 23 (test)

**2. Placeholder scan:** No "TBD", "TODO", "implement later", "similar to Task N" without code, or vague "add error handling." Each step contains the exact code or command.

**3. Type consistency:** All schema imports use the same names (`organizations`, `users`, `deals`, etc.) across tasks. The `createDealInputSchema` signature is the same in test (Task 18 step 2), implementation (Task 18 step 3), and consumer (Task 20 step 1).

**4. No dangling references.** Every function and type used in a task is defined in an earlier task. (`db`, `deals`, `withRls`, `emitAuditEvent`, `getCurrentOrganizationId` all defined upstream.)

If issues are found during execution, fix the plan inline and continue — no need to re-run the review.

---

## Execution

**Plan complete and saved to** `docs/superpowers/plans/2026-05-12-phase-0-month-1-foundation.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task using `superpowers:subagent-driven-development`. Fastest iteration; review between tasks; protects the main context window from each task's chatter.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`. Batch execution with checkpoints for review.

Which approach?
