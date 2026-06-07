# UI Overhaul — Phase 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw shadcn "neutral" theme with the approved Navy + Teal design-token system (light + dark), swap Inter for Hanken Grotesk + Geist Mono, and wire `next-themes` — non-breaking, so existing shadcn-based screens pick up the new look with zero structural change.

**Architecture:** All tokens live in `packages/ui/src/styles/globals.css` using the **shadcn-v4 composition pattern**: raw semantic custom properties under `:root` (light) and `.dark` (dark), bridged to Tailwind color/font/radius utilities via `@theme inline`, with `@custom-variant dark`. Fonts load via `next/font/google` in the app root layout and expose CSS variables the tokens reference. `next-themes` provides class-based, FOUC-safe dark mode. A `ThemeProvider` + `ThemeToggle` ship from `@cema/ui`.

**Tech Stack:** Next.js 16 (App Router/RSC) · Tailwind CSS v4 (`@tailwindcss/postcss`) · shadcn/ui · `next-themes` · `next/font/google` · Turborepo + pnpm · package `@cema/ui`.

**Branch:** `feat/ui-phase-0-foundation` off `main` (the execution skill creates it). All commits signed (`-S`).

**Spec:** [docs/superpowers/specs/2026-06-07-ui-ux-design-overhaul-design.md](../specs/2026-06-07-ui-ux-design-overhaul-design.md) §4, §4.4, §5, §12, §13.

**Note on color space:** the spec's end-state is OKLCH. To avoid shipping hand-converted (drift-prone) values, tokens are authored here in **hex (the exact approved-mock colors)** and converted to OKLCH as the final verified task (Task 8) using a converter + visual parity check. Hex is valid Tailwind v4 and renders identically; this is a deliberate, spec-sanctioned choice ("hex values are the source-of-truth reference; convert at implementation").

---

### Task 1: Token-contract guard test (TDD red)

A node test that asserts the token system + font/dark wiring exist. It is the regression guard for the whole phase. (apps/web already runs vitest in a node env; `process.cwd()` is `apps/web` at test time.)

**Files:**

- Create: `apps/web/lib/theme/design-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const css = read('../../packages/ui/src/styles/globals.css');
const layout = read('app/layout.tsx');

describe('design tokens — Phase 0 foundation', () => {
  it('wires the Tailwind v4 dark variant and a .dark token block', () => {
    expect(css).toContain('@custom-variant dark');
    expect(css).toMatch(/\.dark\s*\{/);
  });

  it('defines brand, semantic, sidebar and status tokens', () => {
    for (const token of [
      '--primary:',
      '--ring:',
      '--brand-teal:',
      '--savings:',
      '--sidebar:',
      '--status-success:',
      '--sev-critical:',
    ]) {
      expect(css, `missing token ${token}`).toContain(token);
    }
  });

  it('bridges semantic tokens + fonts through @theme inline', () => {
    expect(css).toContain('@theme inline');
    expect(css).toContain('--color-sidebar:');
    expect(css).toContain('--font-sans: var(--font-hanken)');
  });

  it('uses Hanken Grotesk + Geist Mono, never Inter', () => {
    expect(layout).toContain('Hanken_Grotesk');
    expect(layout).toContain('Geist_Mono');
    expect(layout).not.toContain('Inter');
  });

  it('wires FOUC-safe dark mode (ThemeProvider + suppressHydrationWarning)', () => {
    expect(layout).toContain('ThemeProvider');
    expect(layout).toContain('suppressHydrationWarning');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web test -- design-tokens`
Expected: FAIL — current `globals.css` has none of these tokens; `layout.tsx` still imports `Inter`.

- [ ] **Step 3: Commit the red test**

```bash
git add apps/web/lib/theme/design-tokens.test.ts
git commit -S -m "test(ui): add Phase 0 design-token contract guard"
```

---

### Task 2: Author the token system in `@cema/ui` globals.css

Replace the entire file. This is the core of Phase 0.

**Files:**

- Modify (replace whole file): `packages/ui/src/styles/globals.css`

- [ ] **Step 1: Replace `globals.css` with the three-tier token system**

```css
@import 'tailwindcss';

@custom-variant dark (&:is(.dark *));

/* ── Semantic tokens — light ─────────────────────────────────── */
:root {
  --radius: 0.5rem;

  --background: #f8fafc;
  --foreground: #10213f;
  --card: #ffffff;
  --card-foreground: #10213f;
  --popover: #ffffff;
  --popover-foreground: #10213f;

  --primary: #10213f; /* ink navy — primary buttons on light */
  --primary-foreground: #ffffff;
  --secondary: #eef2f8;
  --secondary-foreground: #10213f;
  --muted: #f1f5f9;
  --muted-foreground: #64748b;
  --accent: #f0fdfa; /* teal-50 surface — active/hover */
  --accent-foreground: #0f766e;
  --destructive: #b91c1c;
  --destructive-foreground: #ffffff;

  --border: #e7ecf2;
  --input: #e2e8f0;
  --ring: #0d9488; /* teal focus ring */

  /* brand */
  --brand-navy: #10213f;
  --brand-navy-header: #0e1b33;
  --brand-teal: #0d9488;
  --brand-teal-bright: #14b8a6;
  --savings: #0f9d58;
  --savings-foreground: #047857;

  /* status (text / surface) */
  --status-info: #1d4ed8;
  --status-info-bg: #eff6ff;
  --status-success: #047857;
  --status-success-bg: #ecfdf5;
  --status-warning: #b45309;
  --status-warning-bg: #fffbeb;
  --status-danger: #b91c1c;
  --status-danger-bg: #fef2f2;

  /* severity */
  --sev-low: #475569;
  --sev-low-bg: #f1f5f9;
  --sev-medium: #b45309;
  --sev-medium-bg: #fffbeb;
  --sev-high: #c2410c;
  --sev-high-bg: #fff7ed;
  --sev-critical: #b91c1c;
  --sev-critical-bg: #fef2f2;

  /* charts */
  --chart-1: #0d9488;
  --chart-2: #2563eb;
  --chart-3: #0f9d58;
  --chart-4: #b45309;
  --chart-5: #7c3aed;

  /* sidebar */
  --sidebar: #ecf0f7;
  --sidebar-foreground: #475569;
  --sidebar-primary: #0f766e;
  --sidebar-primary-foreground: #f0fdfa;
  --sidebar-accent: #f0fdfa;
  --sidebar-accent-foreground: #0f766e;
  --sidebar-border: #dde4ef;
  --sidebar-ring: #0d9488;
}

/* ── Semantic tokens — dark ──────────────────────────────────── */
.dark {
  --background: #0b1220;
  --foreground: #e8eef6;
  --card: #111a2e;
  --card-foreground: #e8eef6;
  --popover: #111a2e;
  --popover-foreground: #e8eef6;

  --primary: #2dd4bf; /* teal — primary action on dark (navy would vanish) */
  --primary-foreground: #06241f;
  --secondary: #18233b;
  --secondary-foreground: #e8eef6;
  --muted: #18233b;
  --muted-foreground: #94a3b8;
  --accent: #15324a;
  --accent-foreground: #5eead4;
  --destructive: #f87171;
  --destructive-foreground: #0b1220;

  --border: #22304d;
  --input: #28385a;
  --ring: #2dd4bf;

  --brand-navy: #0b1220;
  --brand-navy-header: #0b1220;
  --brand-teal: #2dd4bf;
  --brand-teal-bright: #5eead4;
  --savings: #34d399;
  --savings-foreground: #6ee7b7;

  --status-info: #93b4fd;
  --status-info-bg: #16233f;
  --status-success: #6ee7b7;
  --status-success-bg: #0f2a22;
  --status-warning: #fcd34d;
  --status-warning-bg: #2a2410;
  --status-danger: #fda4af;
  --status-danger-bg: #2a1416;

  --sev-low: #94a3b8;
  --sev-low-bg: #1a2335;
  --sev-medium: #fcd34d;
  --sev-medium-bg: #2a2410;
  --sev-high: #fdba74;
  --sev-high-bg: #2a1c10;
  --sev-critical: #fda4af;
  --sev-critical-bg: #2a1416;

  --chart-1: #2dd4bf;
  --chart-2: #60a5fa;
  --chart-3: #34d399;
  --chart-4: #fbbf24;
  --chart-5: #a78bfa;

  --sidebar: #0e1830;
  --sidebar-foreground: #b9c7dc;
  --sidebar-primary: #5eead4;
  --sidebar-primary-foreground: #06241f;
  --sidebar-accent: #15324a;
  --sidebar-accent-foreground: #5eead4;
  --sidebar-border: #22304d;
  --sidebar-ring: #2dd4bf;
}

/* ── Bridge semantic tokens → Tailwind utilities ─────────────── */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-brand-navy: var(--brand-navy);
  --color-brand-navy-header: var(--brand-navy-header);
  --color-brand-teal: var(--brand-teal);
  --color-brand-teal-bright: var(--brand-teal-bright);
  --color-savings: var(--savings);
  --color-savings-foreground: var(--savings-foreground);

  --color-status-info: var(--status-info);
  --color-status-info-bg: var(--status-info-bg);
  --color-status-success: var(--status-success);
  --color-status-success-bg: var(--status-success-bg);
  --color-status-warning: var(--status-warning);
  --color-status-warning-bg: var(--status-warning-bg);
  --color-status-danger: var(--status-danger);
  --color-status-danger-bg: var(--status-danger-bg);
  --color-sev-low: var(--sev-low);
  --color-sev-low-bg: var(--sev-low-bg);
  --color-sev-medium: var(--sev-medium);
  --color-sev-medium-bg: var(--sev-medium-bg);
  --color-sev-high: var(--sev-high);
  --color-sev-high-bg: var(--sev-high-bg);
  --color-sev-critical: var(--sev-critical);
  --color-sev-critical-bg: var(--sev-critical-bg);

  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  --font-sans: var(--font-hanken), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-family: var(--font-sans);
  }
}
```

- [ ] **Step 2: Typecheck the package (CSS-only change, just confirm nothing broke)**

Run: `pnpm --filter @cema/ui typecheck`
Expected: PASS (no TS change).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/styles/globals.css
git commit -S -m "feat(ui): Navy+Teal token system with light/dark in globals.css"
```

---

### Task 3: Add `next-themes` + ship `ThemeProvider` and `ThemeToggle` from `@cema/ui`

**Files:**

- Modify: `packages/ui/package.json` (add `next-themes` dependency)
- Create: `packages/ui/src/components/theme-provider.tsx`
- Create: `packages/ui/src/components/theme-toggle.tsx`
- Modify: `packages/ui/src/index.ts` (add two exports)

- [ ] **Step 1: Add the dependency**

In `packages/ui/package.json`, add `"next-themes": "^0.4.0"` to `dependencies` (keep alphabetical order — between `lucide-react` and `tailwind-merge`):

```json
  "dependencies": {
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.460.0",
    "next-themes": "^0.4.0",
    "tailwind-merge": "^2.5.0"
  },
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates; `next-themes` resolved.

- [ ] **Step 3: Create `theme-provider.tsx`**

```tsx
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
```

- [ ] **Step 4: Create `theme-toggle.tsx`** (mounted-guarded to avoid hydration mismatch)

```tsx
'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { Button } from './button';

const ORDER = ['light', 'dark', 'system'] as const;
type ThemeChoice = (typeof ORDER)[number];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Render a stable placeholder on the server / first paint.
  if (!mounted) {
    return (
      <Button variant="ghost" size="sm" aria-label="Toggle theme" disabled>
        <Monitor className="h-4 w-4" />
      </Button>
    );
  }

  const current = (ORDER as readonly string[]).includes(theme ?? '')
    ? (theme as ThemeChoice)
    : 'system';
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = current === 'dark' ? Moon : current === 'light' ? Sun : Monitor;

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Theme: ${current}. Switch to ${next}.`}
      onClick={() => setTheme(next)}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
```

- [ ] **Step 5: Export both from the package index**

Add to `packages/ui/src/index.ts`:

```ts
export { ThemeProvider } from './components/theme-provider';
export { ThemeToggle } from './components/theme-toggle';
```

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @cema/ui typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/package.json packages/ui/src/components/theme-provider.tsx packages/ui/src/components/theme-toggle.tsx packages/ui/src/index.ts pnpm-lock.yaml
git commit -S -m "feat(ui): add next-themes ThemeProvider + ThemeToggle"
```

---

### Task 4: Swap fonts + wire `ThemeProvider` in the app root layout (TDD green)

**Files:**

- Modify (replace whole file): `apps/web/app/layout.tsx`

- [ ] **Step 1: Replace `layout.tsx`**

```tsx
import { ClerkProvider } from '@clerk/nextjs';
import { ThemeProvider } from '@cema/ui';
import type { Metadata } from 'next';
import { Geist_Mono, Hanken_Grotesk } from 'next/font/google';

import './globals.css';

const fontSans = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
});
const fontMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Project_CEMA',
  description: 'AI-powered CEMA mortgage processing for NY-state lenders',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable}`}
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ClerkProvider>{children}</ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

> **Fallback:** if the build reports `Geist_Mono` is not an export of `next/font/google` (font data older than expected), install the official package instead — `pnpm --filter web add geist` — and replace the mono import with `import { GeistMono } from 'geist/font/mono';`, drop the `fontMono` constant, and use `${fontSans.variable} ${GeistMono.variable}` on `<html>` (GeistMono's variable is `--font-geist-mono`).

- [ ] **Step 2: Run the guard test — now green**

Run: `pnpm --filter web test -- design-tokens`
Expected: PASS (all five assertions; `globals.css` from Task 2 + this layout satisfy them).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/layout.tsx
git commit -S -m "feat(web): load Hanken Grotesk + Geist Mono, wire next-themes provider"
```

---

### Task 5: Tailwind content scanning (`@source`) + ThemeToggle in the app header

Tailwind v4 (`@tailwindcss/postcss`) does **not** honor the legacy `tailwind.config.ts` `content` array, and it auto-scans only the build root (`apps/web`), not the sibling `packages/ui/src`. Add `@source` so classes used only in `@cema/ui` components (e.g. the new ThemeToggle) are generated.

**Files:**

- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/(app)/layout.tsx`

- [ ] **Step 1: Register the shared-package source**

Replace `apps/web/app/globals.css` with:

```css
@import '@cema/ui/styles/globals.css';
@source '../../../packages/ui/src/**/*.{ts,tsx}';
```

- [ ] **Step 2: Drop the ThemeToggle into the app header**

In `apps/web/app/(app)/layout.tsx`: add the import and replace the header's right side.

Add to imports:

```tsx
import { ThemeToggle } from '@cema/ui';
```

Replace the `<header>` block:

```tsx
<header className="bg-card flex items-center justify-between border-b px-6 py-3">
  <OrganizationSwitcher />
  <div className="flex items-center gap-2">
    <ThemeToggle />
    <UserButton />
  </div>
</header>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/globals.css "apps/web/app/(app)/layout.tsx"
git commit -S -m "feat(web): scan @cema/ui sources (@source) + header theme toggle"
```

---

### Task 6: Full-build verification (incl. the Windows + Turbopack watch-out)

No code — gates that the foundation is sound end-to-end.

- [ ] **Step 1: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages (33/33 historically green).

- [ ] **Step 2: Production build**

Run: `pnpm --filter web build`
Expected: build succeeds — this exercises Tailwind v4 + PostCSS + `next/font` resolution. A failure here usually means a font name typo or a CSS token syntax error.

- [ ] **Step 3: Dev server (Turbopack panic check)**

Run: `pnpm --filter web dev`
Expected: dev server boots clean on `http://localhost:3000`.

> **Watch-out (you are on Windows):** if `next dev --turbo` panics with a `nul`/PostCSS device error (Tailwind v4 + Next 16 + Turbopack on Windows — tracked in next.js#90860), stop, then run `pnpm --filter web exec next dev --webpack` to confirm the app itself is healthy, and record the panic in the PR description as a known dev-only issue (it does not affect `next build`). Do **not** block the phase on it.

- [ ] **Step 4: Manual light/dark verification**

Open `http://localhost:3000` (sign in), then:

- Confirm body text/UI renders in **Hanken Grotesk** (not Inter) and any mono/ID text in **Geist Mono**.
- Click the header **theme toggle**: cycles light → dark → system; the `.dark` class toggles on `<html>`; surfaces, text, borders, and primary buttons all flip correctly with **no flash** on reload.
- Spot-check 3 screens (`/dashboard`, `/deals`, a deal hub): existing shadcn `Button`/`Card`/`Input` now use navy/teal/cool-gray tokens; nothing is structurally broken.

Expected: all pass. (Raw-Tailwind-colored ad-hoc components — e.g. `bg-blue-600` buttons — will **not** change yet; that is Phase 3. Note any that look jarring for the Phase 3 backlog.)

- [ ] **Step 5: Unit + (default) test suite still green**

Run: `pnpm --filter web test`
Expected: PASS, including the new `design-tokens` guard.

- [ ] **Step 6: Commit any verification fixes** (only if Steps 1–5 required edits)

```bash
git add -p
git commit -S -m "fix(ui): Phase 0 build/verification fixes"
```

---

### Task 7: Convert the palette to OKLCH (spec end-state) + verify parity

Hex renders identically, but the spec's end-state is OKLCH (perceptually uniform scales). Do this last so it is a pure, verifiable refinement.

**Files:**

- Modify: `packages/ui/src/styles/globals.css`

- [ ] **Step 1: Convert every `:root` and `.dark` hex value to `oklch(...)`**

Use a precise converter (e.g. https://oklch.com or the `culori` CLI) — do **not** eyeball it. Convert only the raw token values in `:root` and `.dark`; leave the `@theme inline` `var(--…)` references and `calc()` radii untouched. Example mapping (verify each with the converter):

```css
/* light */
--background: oklch(0.984 0.003 247.86); /* was #f8fafc */
--foreground: oklch(0.246 0.045 257.4); /* was #10213f */
--primary: oklch(0.246 0.045 257.4); /* #10213f */
--brand-teal: oklch(0.6 0.107 183.5); /* #0d9488 */
--savings: oklch(0.63 0.16 156.2); /* #0f9d58 */
/* …convert all remaining tokens the same way… */
```

- [ ] **Step 2: Guard test + build still pass**

Run: `pnpm --filter web test -- design-tokens && pnpm --filter web build`
Expected: PASS (the guard asserts token **names**, not formats, so it stays green).

- [ ] **Step 3: Visual parity check**

Reload `http://localhost:3000` in light **and** dark. Colors must look identical to the hex version (OKLCH is a representation change, not a redesign). Diff against the reference mock (`docs/superpowers/specs/assets/2026-06-07-ui-overhaul-reference-mock.html`) if unsure.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/styles/globals.css
git commit -S -m "refactor(ui): express design tokens in OKLCH"
```

---

## Definition of done (Phase 0)

- `globals.css` carries the full Navy + Teal token system (light + `.dark`, OKLCH), bridged via `@theme inline`.
- App loads Hanken Grotesk + Geist Mono; no `Inter`.
- `next-themes` dark mode works (toggle in header, no FOUC); `ThemeProvider`/`ThemeToggle` exported from `@cema/ui`.
- `@source` registers `packages/ui/src` so shared-package classes generate.
- `pnpm typecheck`, `pnpm --filter web build`, and `pnpm --filter web test` (incl. the `design-tokens` guard) all pass.
- Existing shadcn-based screens render in the new palette with **zero structural change**; raw-Tailwind ad-hoc components are catalogued for Phase 3.
- 0 schema/migration changes; no functional behavior change.

## Self-review notes (author)

- **Spec coverage:** §4 tokens → Task 2/7; §4.4 fonts → Task 4; §5 dark mode → Task 3/4; §12 `@source`/transpilePackages → Task 5 (transpilePackages already present); §12 Windows/Turbopack → Task 6 Step 3; §13 Phase 0 non-breaking → Task 6 Step 4. Covered.
- **Type consistency:** font CSS vars `--font-hanken` / `--font-geist-mono` are defined by `next/font` in Task 4 and referenced by `@theme inline` in Task 2 — names match. `ThemeProvider`/`ThemeToggle` exported (Task 3) and imported (Task 4/5) under identical names.
- **No placeholders:** every code/CSS block is complete; the only "fill in" is Task 7 Step 1, which is an explicit mechanical conversion with a worked example and a named tool (not a vague TODO).
