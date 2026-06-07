# Project_CEMA — UI/UX/Design System Overhaul

> **Design spec.** Authoritative on _what the overhaul is and how it should look/behave_. Implementation plans are derived from this via `superpowers:writing-plans`. This spec does **not** replace the product design spec ([2026-05-12-cema-ai-processor-design.md](2026-05-12-cema-ai-processor-design.md)) — it defines the visual + interaction layer on top of it.

- **Date:** 2026-06-07
- **Author:** Connor Hickey + Claude (Opus 4.8)
- **Status:** Approved (brainstorm) → ready for implementation planning
- **Reference mock (approved):** `docs/superpowers/specs/assets/2026-06-07-ui-overhaul-reference-mock.html` (the locked look, rendered)

---

## 1. Goal & scope

Replace the current **raw, barely-themed shadcn** UI with a cohesive, production-grade design system that is simultaneously:

1. **Production-ready** — processors and attorneys live in this 8 hrs/day; clarity, density, trust, and ergonomics win over flash.
2. **Demo-impressive** — it must read as a real, successful, widely-used B2B fintech product to design partners and investors.
3. **Engineering-consistent** — a rigorous token + component system so every future screen is fast to build and uniform, ending the current ad-hoc drift.

**In scope:** design tokens, theme (light + dark), typography, iconography, motion, the shared component kit (`@cema/ui`), the app shell, information architecture, and a screen-by-screen redesign of every authenticated surface in `apps/web`.

**Out of scope:** new product features, backend/schema changes, the Layer-4 voice agent UI (Phase 3 product), marketing site. The overhaul is **non-breaking and incremental** — it re-skins and re-organizes existing functionality; it does not change what the app _does_.

**North star:** _Credibility comes from restraint and from where color/typography go — not from how much._ Every choice below is chosen to read "shipped fintech product," not "AI-generated admin panel."

---

## 2. Current state (the starting point)

A code audit (2026-06-07) found:

- **Tailwind v4 + shadcn/ui**, but only **4 shared primitives** in `@cema/ui` (Button, Card, Input, Label). No Badge, Alert, Dialog, Tabs, Table, Toast, Skeleton, Command, etc.
- **Raw shadcn "neutral" theme** — six pure greys, zero saturation, **no brand color, no dark mode**, Inter at default settings.
- **~35 routes** and **~33 ad-hoc components** in `apps/web` styled with inline Tailwind; buttons, badges, error text, empty states, grids, and hover states drift screen-to-screen.
- **No chart layer** — the dashboard funnel and stats are hand-rolled CSS.
- **Deal-centric IA** with a discoverability problem: 5 deal tabs visible, ~5 more sub-views reachable only by URL; no breadcrumbs, no global search/command palette, no role-aware shell.

The foundation (Tailwind v4 + shadcn) is good; it is simply **unpainted and inconsistent**. The overhaul layers on top — it does not re-platform.

---

## 3. Design principles

Derived from research into best-in-class B2B fintech (Stripe, Linear, Vercel, Mercury, Ramp, Harvey AI) and the documented "AI-generated UI" anti-patterns.

1. **Restraint signals confidence.** One primary action per screen; accent color rationed to active states, links, and key data. Most pixels are neutral.
2. **Color earns its place in three slots only:** a vibrant brand/accent, a rich status/severity system, and data visualization — on a calm canvas.
3. **Flat, crisp surfaces.** 1px hairline borders separate regions; shadows are minimal and reserved for true overlays (dialogs, popovers, command palette). No gradient cards, no glows.
4. **Density with purpose.** Every pixel works; tables are dense, numbers are tabular and right-aligned, whitespace is deliberate — not padding-everything-to-16px.
5. **Real craft, not template tells.** A true icon set (Lucide) at one weight; a non-default grotesk; a left-rail app shell; tight 6–8px radii. **Avoid** the named AI tells: Inter-everywhere, emoji icons, purple/indigo gradients, big soft shadows, over-rounded pills, centered-everything.
6. **Color is never the sole signal** (WCAG): every status = icon + label + color.
7. **Trust is the product.** Attorney-gate state, "draft — pending review," AI-agent provenance, and the immutable audit trail must be legible without alarming daily users.

References: [Stripe/Linear/Vercel principles](https://www.pixeldarts.com/en/post/four-design-principles-behind-stripe-linear-and-vercel) · [Harvey design](https://www.harvey.ai/blog/how-we-approach-design-at-harvey) · [AI-look anti-patterns](https://docs.bswen.com/blog/2026-03-20-ai-generated-ui-anti-patterns/) · [AI purple problem](https://dev.to/jaainil/ai-purple-problem-make-your-ui-unmistakable-3ono)

---

## 4. Visual identity & design tokens

Tokens are authored in **OKLCH** in `packages/ui/src/styles/globals.css` (Tailwind v4 `@theme` + CSS custom properties; shadcn v4 composition). Hex values below are the **source-of-truth reference** from the approved mock; convert to OKLCH at implementation (perceptually uniform scales, free on this stack). Token layering is three-tier: **primitive → semantic → component**.

### 4.1 Brand

| Token                   | Hex (ref)                  | Role                                                                    |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `--brand-navy` (ink)    | `#10213F`                  | Headings, primary text, primary buttons on light, dark surfaces         |
| `--brand-navy-header`   | `#0E1B33`                  | The top app header background                                           |
| `--brand-teal` (accent) | `#0D9488`                  | Links, active nav, focus rings, primary CTA **on navy**, the brand mark |
| `--brand-teal-bright`   | `#14B8A6` / `#2DD4BF`      | Logomark, highlights, dark-mode accent                                  |
| `--savings-green`       | `#0F9D58` (text `#047857`) | **Reserved** — §255 savings figures, "approved," "recorded" only        |

**Brand rationale (marketing/branding):** Navy = the non-negotiable trust/authority anchor for an attorney-facing finance tool. Teal = the **ownable** differentiator — the mortgage/legal-tech category (Qualia, Snapdocs, Clio) is monolithically navy/blue, and violet/indigo now reads "generic AI"; teal occupies the open lane: modern + distinct + still credible. Green is **reserved as a semantic** ("we saved you money," the product's whole pitch) rather than spent as the brand — so it lands when it appears. Sources: [category color landscape](https://www.postdigitalist.xyz/blog/fintech-and-the-brand-differentiation-problem) · [finance color psychology](https://bethanyworks.com/color-psychology-financial-services-brands/) · [green = success-state in fintech UI](https://www.billcut.com/blogs/color-psychology-in-fintech-ui-why-green-dominates/).

### 4.2 Neutrals — single cool-gray ramp

One ramp, never mixed with warm grey. Light surfaces anchor **off pure white** to reduce 8-hour glare.

`#0B0F1A · #1E293B · #334155 · #475569 · #64748B · #94A3B8 · #CBD5E1 · #E2E8F0 · #EDF1F7 · #F1F5F9 · #F8FAFC · #FFFFFF`

Special: **`--sidebar` `#ECF0F7`** (cool blue-gray tint) so the nav rail reads as a distinct zone from the white workspace; hairline border default `#E7ECF2`.

### 4.3 Status & severity (icon + label + color, always)

| Status  | Text      | Surface   | Use                                           |
| ------- | --------- | --------- | --------------------------------------------- |
| Info    | `#1D4ED8` | `#EFF6FF` | neutral state, "recording"                    |
| Success | `#047857` | `#ECFDF5` | executed, recorded, chain clean               |
| Warning | `#B45309` | `#FFFBEB` | pending attorney review, SLA approaching      |
| Danger  | `#B91C1C` | `#FEF2F2` | rejected recording, lost note, gate violation |

**Severity scale** (Exception Triage / chain-break routing) — one hue family stepped by lightness/chroma, **plus a distinct icon/label per level** (never four invented hues):

`low` slate (`#475569`/`#F1F5F9`) → `medium` amber (`#B45309`/`#FFFBEB`) → `high` orange (`#C2410C`/`#FFF7ED`) → `critical` red (`#B91C1C`/`#FEF2F2`).

Each status/severity ships **three tokens**: `--x-text` (AA 4.5:1), `--x-border` (3:1), `--x-bg` (tinted surface). Maps directly onto existing routes (`processor_review` / `attorney_review` / `re_chase`).

### 4.4 Typography

- **UI / display:** **Hanken Grotesk** (`--font-sans`) — the best free Söhne-class grotesk; deliberately **not Inter** (the default/AI tell), reads premium + calm. Weights 400/500/600/700.
- **Numeric / IDs:** **Geist Mono** (`--font-mono`) — deal IDs, CRFN, reel/page, loan numbers, audit hashes; slashed zero, "engineered" feel.
- **Tabular figures everywhere money lives:** `font-variant-numeric: tabular-nums` as a token (`.tnum`), applied to every UPB / gap / fee / tax / savings cell, right-aligned.
- **No serif in-product** (serif reads "editorial/AI-template" in a dense fintech app). A restrained serif may be used _only_ on generated PDF reports/covers if desired later.
- **Scale (tight tracking on display):** deal title h1 ~21px / `-0.02em`; section h2 ~14px/600; body 13–14px; label/caption 11–12px; uppercase eyebrow 10.5px / `.08em`.

Both faces: Google Fonts + npm, variable, OFL. Loaded via `next/font` to avoid layout shift.

### 4.5 Space, radius, border, elevation

- **Spacing:** 8px grid (4 / 8 / 12 / 16 / 20 / 24 / 32 …).
- **Radius:** `sm` 6px (chips, badges, inputs), `md` 8px (buttons, cards), `lg` 10–12px (panels). **Never** pill-radius everything.
- **Borders:** 1px hairline (`#E7ECF2`) as the primary separator.
- **Elevation:** flat by default. Shadow only on true overlays — Dialog/Popover/Command/DropdownMenu/Sheet (a tight, close-range shadow). The app window itself may carry one soft container shadow; interior surfaces do not.

### 4.6 Motion

- **Library:** `motion` (formerly Framer Motion). CSS-first (`tw-animate-css` + native `linear()` easing) where possible; reach for `motion` for orchestration (list reorder, `AnimatePresence` on Dialog/Sheet, shared-layout deal transitions). Reduce bundle with `LazyMotion`/`m`.
- **Principles:** animate **enter/exit, state change, focus** only — 120–220ms, ease-out. Globally respect `prefers-reduced-motion`. **Never** animate data tables/rows on load, ticking number counters, or anything that delays reading legal/financial data.

### 4.7 Iconography

**Lucide** (`lucide-react`, already a dependency) — one set, **16px, single stroke weight, `currentColor`**, never decorative, never mixed with another set. (Phosphor only if duotone weight hierarchy is ever needed.)

---

## 5. Dark mode

- **`next-themes`** with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`, provider **inside `<body>`**; `suppressHydrationWarning` on `<html>`. Its render-blocking inline script kills FOUC under RSC.
- Tailwind v4 dark variant keys off `.dark` (`@custom-variant dark (&:is(.dark *))`).
- Every semantic token has a `:root` (light) and `.dark` value; charts inherit via `var(--chart-n)` and flip for free.
- Default **system**; persist explicit user choice. Theme toggle in the user menu (pure CSS icon swap `hidden dark:block` to avoid hydration mismatch).

Source: [shadcn Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4) · [next-themes](https://github.com/pacocoursey/next-themes).

---

## 6. App shell

The locked shell (see reference mock):

- **Navy top header** (full width, `--brand-navy-header`): logomark + neutral **Workspace switcher** (no product name yet — see §15), global **search field** (⌘K), notifications bell, and the primary **"New deal"** action **in teal** (buttons on navy are never navy). White/light text + icons.
- **Tinted left rail** (`--sidebar`): grouped nav with Lucide icons + count badges; active item = teal-50 surface + teal text/icon; user/profile chip pinned to the bottom (Linear-style).
- **Workspace (white)** to the right: a **breadcrumb bar**, then page content.
- **Sticky deal header** inside the deal hub (borrower · property · status · stage · §255 savings · primary CTA) — context never scrolls away.
- **⌘K command palette** (cmdk): jump to any deal, sub-view, queue, or action by keystroke.

Layout primitives: a single `PageShell` (max-width, padding, breadcrumb slot, page-header slot) so screens stop rolling their own.

---

## 7. Information architecture (approved)

### 7.1 Global navigation (left rail)

`Dashboard · Deals · Queues · Exceptions · Contacts · Settings` + the ⌘K palette. Role-aware later (processor vs attorney emphasis), but one rail for all.

### 7.2 Deal hub — consolidate ~10 sub-views → 7

A **sticky deal header** + a horizontal **sub-tab** row (icons + teal active underline):

| Today (scattered)                          | Proposed                                                                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                                   | **Overview** — status, stage, savings, next action, key cards                                                                                                               |
| Parties                                    | **Parties**                                                                                                                                                                 |
| Loans                                      | **Loans** (Schedule A)                                                                                                                                                      |
| Documents + Chain-of-title + Files (Drive) | **Documents** — collateral file + generated package + **Chain-of-title** (section) + **Drive files** (inbox/linked) nested; they are one mental model: the collateral chain |
| Communications + Activity + Agent-activity | **Timeline** — one feed, source filter `All · Comms · Agents · System`                                                                                                      |
| Graph                                      | **Graph** — KG relationships                                                                                                                                                |
| Exceptions                                 | **Exceptions** (deal-scoped)                                                                                                                                                |

The **unified Timeline** is the highest-leverage IA fix: it kills two "hidden tabs" and is where **AI-agent provenance** lives (show _which agent did what, at the decision point_ — the #1 trust signal for an AI product). Breadcrumbs: `Deals / [Borrower · Property] / [sub-view]`.

### 7.3 Queues → real inboxes

Attorney review, chain-break review, and org-wide exceptions become **power-user inboxes**: severity-sorted dense rows, inline **claim/assign** with owner avatar, **keyboard triage** (j/k move, Enter open, c claim, e resolve), **saved filters** ("my unclaimed", "high severity", "SLA breaching"), and **bulk actions** (checkbox → pinned action bar). Empty states say what "good" looks like ("No open reviews — pipeline clear").

References: [Stripe detail-page IA](https://docs.stripe.com/stripe-apps/design) · [command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/) · [data-table UX](https://www.eleken.co/blog-posts/table-design-ux) · [AI agent UX / provenance](https://fuselabcreative.com/ui-design-for-ai-agents/).

---

## 8. Component kit (`@cema/ui`)

Build out shadcn-based primitives, themed to the tokens, exported from `@cema/ui`. Default to **Server Components**; add `'use client'` only at interactive leaves (never on the package index). Standardize on the single `radix-ui` package.

**Tier 1 — workspace backbone:** `DataTable` (TanStack Table + shadcn cells: sort/filter/paginate/column-visibility), `Table`, `Badge` (wired to status/severity tokens), `Dialog` + `AlertDialog` (attorney-gate / destructive confirms), `DropdownMenu`, `Select`, `Tabs`, `Tooltip`, `Toast` → **Sonner**, `Skeleton`.

**Tier 2 — power-user + forms:** `Command` (cmdk palette), `Combobox` (servicer/party pickers), `Popover`, `Sheet` (deal quick-view side panel), `Form` (RHF + Zod), `Separator`, `ScrollArea`, `Avatar`, `Breadcrumb`, `Sidebar` (composed shell), `ThemeToggle`.

**Tier 3 — polish:** `HoverCard`, `Accordion`, `Progress`, `Calendar`/`DatePicker`, `Pagination`, `Resizable`, chart components.

**App-domain components (built on the above):** `StatusBadge`, `SeverityBadge`, `AttorneyGateBadge`, `AgentChip` (provenance), `MoneyCell` (tabular), `DealHeader`, `Timeline`, `EmptyState`, `PageShell`, `QueueRow`.

**Charting:** **shadcn/ui Charts (Recharts v3)** — `ChartContainer` + `ChartConfig` make charts theme-aware via `var(--chart-1…5)` and dark-mode-aware for free; ideal for the dashboard funnel + per-agent stats. Drop to Chart.js only if a single view ever renders >1–2k points. ([shadcn chart](https://ui.shadcn.com/docs/components/radix/chart))

---

## 9. Screen-by-screen direction

Every screen uses `PageShell` + the token system. Highlights:

- **Dashboard** — pipeline funnel (Recharts) + per-agent stat cards (clickable → filtered feeds) + org-wide agent-activity feed; date-range + agent filters (already exist — re-skinned). KPI cards use tabular money.
- **Deals list** — replace the card grid with a **DataTable** (deal · property · stage · savings · next action · owner), sticky header, density toggle, status filter chips, saved views; keep a card view as an option.
- **Deal hub** — §7.2. Sticky `DealHeader`; sub-tabs; Overview composes Parties/Loans/Property/Savings summary cards.
  - **Documents** — three groups (Received collateral · Generated package · Other) with the IDP instrument list (gate-required first), **Chain-of-title** findings (status + grouped re-chase/attorney-review breaks), and **Drive files**. `AttorneyGateBadge` + "Draft — pending review" treatment throughout (hard rule #2).
  - **Timeline** — unified feed with source filter + `AgentChip` provenance + `aria-live` for new items.
  - **Parties / Loans** — inline-editable rows (re-skinned editors), validation inline.
  - **Graph** — KG relationships view re-skinned.
  - **Exceptions** — deal-scoped `SeverityBadge` list.
- **Queues** (`/attorney/queue`, `/attorney/chain-queue`, `/exceptions`) — §7.3 inbox pattern.
- **Attorney review detail** — claim → submit-for-signature / approve / reject (reason); clear gate-state, audit trail visible.
- **Contacts** — DataTable + contact detail (identities, related deals/comms).
- **Search** — ⌘K palette + full results page (deal-centric, intent-classified) re-skinned.
- **Settings** — build out the stub (`/settings/org`): org, members/roles, integrations (OAuth status), theme, notifications.
- **Auth** (`/sign-in`, `/sign-up`) — Clerk components themed to navy/teal.

---

## 10. Accessibility (WCAG 2.1 AA)

- Text contrast ≥ 4.5:1; UI/icon boundaries ≥ 3:1. Status/severity = **icon + label + color** (survives color-blindness and grayscale).
- **Focus**: visible focus rings throughout (keyboard is a primary input); Dialog/Sheet **focus traps** with focus restored to the trigger on close; `AlertDialog` autofocus on the safe action.
- **Live regions**: the Timeline / agent feeds use one `aria-live="polite"` (or `role="log"`) region, batched to meaningful events — **never `assertive`** except a blocking compliance error.
- Forms: errors tied to inputs via `aria-describedby`; `lang` on `<html>`.
- Honor `prefers-reduced-motion`.

---

## 11. Trust & compliance UI (non-negotiable)

- **Attorney-gate (hard rule #2):** gate-required documents render an `AttorneyGateBadge` + a persistent "Draft — pending attorney review" banner on the document; they cannot present as executed/recorded without an approval event. Reserve red for true violations; routine gating is a neutral/amber chip, not an alarm.
- **AI-agent provenance:** `AgentChip` tags agent-authored items with agent name + timestamp; expand reveals the tool/inputs/outputs at the decision point + one-click human override. Confidence shown as **binary high/low** (solid vs hatched), not a misleading %.
- **Audit timeline:** immutable, append-only, actor + action + timestamp, layered detail (summary → expand). Mirrors hard rules #3 (no PII in logs/labels — UI shows tokens/ids, never SSN/payoff/name+address) and audit immutability.

---

## 12. Technical architecture

- **Token home:** `packages/ui/src/styles/globals.css` owns Tailwind v4, PostCSS, the three-tier OKLCH tokens, and `:root`/`.dark`. Bridge to utilities with `@theme inline` (`--color-background: var(--background)`). Reference chart tokens as `var(--chart-1)` (not `hsl(var(...))`) — shadcn v4 + Recharts v3.
- **Package structure:** `@cema/ui` exports `components/*`, `lib/utils` (`cn`), `hooks/*`; `apps/web` consumes (`import { Button } from "@cema/ui/components/button"`); `components.json` keeps `css` pointing at the shared globals; `tailwind.config` left empty (config lives in CSS).
- **Monorepo gotchas:** add `@source "../../packages/ui/src"` in globals so shared-package classes generate; `transpilePackages: ['@cema/ui']` in `next.config`; re-run shadcn primitives for `data-slot` + no-`forwardRef` (React 19) versions; `tailwindcss-animate` → `tw-animate-css`.
- **Windows + Turbopack watch-out:** Tailwind v4 + Next 16 + Turbopack has a reported `nul`/PostCSS panic on Windows ([next#90860](https://github.com/vercel/next.js/issues/90860)). If it bites during dev, fall back to `next dev --webpack`; track before committing the foundation. (Connor is on Windows 11 — verify early.)
- **Radix:** prefer the single `radix-ui` package; when customizing `asChild` components, spread all props + forward refs to preserve a11y/handlers.

---

## 13. Phased rollout (non-breaking)

Each phase is independently shippable and leaves `main` green. Maps to implementation plans.

- **Phase 0 — Foundation.** OKLCH token system + `:root`/`.dark` in `@cema/ui/globals.css`; fonts (Hanken Grotesk + Geist Mono via `next/font`); dark mode (`next-themes`); `@source`/`transpilePackages`/Turbopack verification. _Deliverable: tokens + theming live; existing screens visually shift to the new neutrals/brand with zero structural change._
- **Phase 1 — Component kit.** Build Tier 1 (+ Sonner, Skeleton) then Tier 2 in `@cema/ui`; add domain components (`StatusBadge`, `SeverityBadge`, `AttorneyGateBadge`, `AgentChip`, `MoneyCell`, `DealHeader`, `Timeline`, `EmptyState`, `PageShell`). _Deliverable: a documented component library; no app screens changed yet._
- **Phase 2 — App shell & IA.** Navy header + tinted sidebar + breadcrumb + ⌘K command palette + `PageShell`; role-aware nav; deal-hub sub-nav consolidation (the 7-tab structure) + sticky `DealHeader` + unified Timeline. _Deliverable: new shell + IA across the app._
- **Phase 3 — Screen redesigns.** Apply the system screen-group by screen-group: (a) Dashboard + Deals list (DataTable + charts); (b) Deal hub sub-views (Documents/Chain, Timeline, Parties, Loans, Graph, Exceptions); (c) Queues/inboxes + attorney review; (d) Contacts, Search, Settings, Auth.
- **Phase 4 — Polish & a11y pass.** Motion, empty/loading/skeleton states, full WCAG AA audit, visual-regression snapshots, dark-mode QA.

Each phase ends with screenshots and a CodeRabbit + self-review pass. Visual-regression (Playwright screenshots) guards against drift.

---

## 14. Success criteria

- A design partner / investor reads the app as a **real, shipped B2B fintech product** (not a generated admin panel).
- **Zero ad-hoc colors/spacing** in `apps/web`: every surface uses tokens + `@cema/ui` components (lint/grep gate: no raw hex in `apps/web` outside tokens; no inline `bg-blue-*`/`text-red-*` for status — use `StatusBadge`).
- Light **and** dark mode both polished; WCAG 2.1 AA verified.
- Component kit covers ≥ 95% of UI needs; new screens build without bespoke CSS.
- No regression in functionality; all existing tests green; hard rules #2/#3 and audit immutability visibly upheld in the UI.

---

## 15. Open questions

1. **Product name + domain** (product spec §18 #6) — the header wordmark is a placeholder ("Workspace"); naming is a separate decision and **must not be invented** here.
2. **Typeface final call** — Hanken Grotesk is locked unless Connor wants the Hanken vs **Geist Sans** vs **Schibsted Grotesk** face-off first.
3. **Density default** — ship a density toggle (comfortable/compact) on tables, or pick one default?
4. **Design-partner input** — any house style / brand constraints from the eventual design-partner lender that should fold in before Phase 3 screens?
5. **Visual-regression tooling** — Playwright screenshots (in-repo) vs a hosted service (Chromatic/Percy).

---

## 16. References

**Approved mock:** `assets/2026-06-07-ui-overhaul-reference-mock.html`. **Research briefs** (full, with sources) were produced during brainstorming on: visual identity & color, data-dense legal/fintech UX, the Tailwind v4 / shadcn / dark-mode / charting stack, the mortgage/legal-tech brand-color landscape, and real-fintech typefaces / anti-AI craft. Key external sources are linked inline in §3–§12.
