# Agent Activity Timeline — Design Spec

> **Status:** Approved (Connor, 2026-06-02) — implementation pending.
> **Goal:** Surface the (otherwise invisible) work of the 8 Layer-3/Phase-2 agents as a
> deal-scoped, human-labeled timeline of the `audit_events` they emit. Makes the dormant agent
> layer visible + demoable. No new agent code; reads existing audit data.

---

## 1. Goal & scope

The 8 agents (Intake, Servicer Outreach, Collateral IDP, Chain-of-Title, Exception Triage, Internal
Comms, Borrower Comms, Doc-Gen) each write PII-safe, **deal-scoped** `audit_events` (`entityType =
'deal'`, `entityId = dealId`) — but nothing renders them. This adds a new deal tab
`/deals/[id]/agent-activity` that renders that trail as a clean, human-labeled timeline.

**In scope:**

- A pure `describeAuditEvent(action, metadata) → { label, detail }` (no DB; node-testable) — the
  action→human-label map + a PII-safe per-action detail built only from whitelisted metadata fields.
- An RLS-scoped loader `getDealAgentActivity(dealId)` over `audit_events` (deal-scoped, newest first).
- An RSC page `/deals/[id]/agent-activity` rendering the timeline (mirrors the existing `/activity`
  page's `date-fns` `<ol>`), with an empty state.
- An "Agent activity" nav link on the deal page.

**Out of scope (deferred — carry-overs):**

- Real-time updates / streaming.
- Filter-by-agent / filter-by-action.
- Document-scoped audit events (`entityType = 'document'`, e.g. approvals) — already surfaced on the
  `/documents` review page.
- Pagination cursor (v1 caps at the 200 most-recent, like the M9 `/activity` feed).
- Actor display names (the audit carries `actorUserId`; resolving names is a follow-up).

## 2. Why the audit log is the right source

Every agent already writes a PII-safe, deal-scoped audit row (hard rule #3 + the split-audit
pattern), and the `audit_events` `(entity_type, entity_id)` index makes the per-deal query cheap. So
"make the agents' work visible" needs **no new persistence** — just a read + a label map over data
accumulating since M10. The substance is the pure `describeAuditEvent` function; the loader + page
are thin around it.

## 3. Pure core — `apps/web/lib/agent-activity/describe-audit-event.ts`

```ts
export interface AuditEventDescription {
  readonly label: string;
  readonly detail: string | null;
}

// action -> human label. Covers the agent + lifecycle actions emitted with
// entityType='deal'. Split-audit pre-events (.evaluated / .planned) are labeled
// too (the trail is complete + honest).
const LABEL_BY_ACTION: Record<string, string> = {
  'deal.created': 'Deal created',
  'deal.status_changed': 'Status changed',
  'deal.agent_dispatch_failed': 'Agent dispatch failed',
  'intake.evaluated': 'Intake evaluated',
  'idp.evaluated': 'Collateral IDP evaluated',
  'idp.documents_classified': 'Collateral documents classified',
  'chain.analyzed': 'Chain-of-title analyzed',
  'chain.routed': 'Chain findings routed',
  'chain.break_routed': 'Chain break routed for review',
  'docgen.evaluated': 'Doc generation evaluated',
  'docgen.generated': 'CEMA documents generated',
  'docgen.inconsistent': "Doc generation blocked (numbers don't tie)",
  'internal_comm.evaluated': 'Internal notification evaluated',
  'internal_comm.notified': 'Internal notification sent',
  'borrower_comm.evaluated': 'Borrower notification evaluated',
  'borrower_comm.notified': 'Borrower emailed',
  'outreach.planned': 'Servicer outreach planned',
  'outreach.touch_sent': 'Servicer outreach sent',
  'document.submitted_for_review': 'Document queued for attorney review',
  'document.approved': 'Document approved',
  'document.rejected': 'Document rejected',
};

// Per-action PII-safe detail builders. Each reads ONLY whitelisted metadata
// fields (enum/token/count) -- never a raw dump. Returns null if absent.
const DETAIL_BY_ACTION: Record<string, (m: Record<string, unknown>) => string | null> = {
  'deal.status_changed': (m) =>
    typeof m.from === 'string' && typeof m.to === 'string' ? `${m.from} → ${m.to}` : null,
  'docgen.generated': (m) => (typeof m.count === 'number' ? `${m.count} documents` : null),
  'docgen.evaluated': (m) => (typeof m.count === 'number' ? `${m.count} planned` : null),
  'internal_comm.notified': (m) => (typeof m.channel === 'string' ? `via ${m.channel}` : null),
  'borrower_comm.notified': (m) => (typeof m.channel === 'string' ? `via ${m.channel}` : null),
  'outreach.touch_sent': (m) =>
    typeof m.touchNumber === 'number' ? `touch #${m.touchNumber}` : null,
};

// Humanize an unknown action: 'foo.bar_baz' -> 'Foo bar baz'.
function humanize(action: string): string {
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Pure: map an audit action + metadata to a display label + a PII-safe detail.
 * Unknown actions get a humanized fallback label and no detail. The detail is
 * built only from per-action whitelisted fields (defense in depth: never render
 * raw metadata, even though agent metadata is PII-safe by policy).
 */
export function describeAuditEvent(
  action: string,
  metadata: Record<string, unknown> | null | undefined,
): AuditEventDescription {
  const label = LABEL_BY_ACTION[action] ?? humanize(action);
  const detail = DETAIL_BY_ACTION[action]?.(metadata ?? {}) ?? null;
  return { label, detail };
}
```

## 4. Loader — `apps/web/lib/queries/deal-agent-activity.ts`

```ts
export interface DealAgentActivityEvent {
  readonly id: string;
  readonly action: string;
  readonly occurredAt: Date;
  readonly metadata: Record<string, unknown>;
}

export async function getDealAgentActivity(dealId: string): Promise<DealAgentActivityEvent[]>;
```

RLS-scoped (resolve Clerk org → `withRls`, mirroring `getDealDocumentsReview`); selects from
`auditEvents` where `entityType = 'deal'` AND `entityId = dealId`, `orderBy(desc(occurredAt))`,
`limit(200)`. Returns `[]` if the org is unresolved.

## 5. Page + nav

- `apps/web/app/(app)/deals/[id]/agent-activity/page.tsx` (RSC): `getDealAgentActivity(id)` → map
  each row via `describeAuditEvent(action, metadata)` → render the `date-fns` `<ol>` timeline (label,
  detail, `formatDistanceToNow(occurredAt)`), with a "No agent activity yet." empty state. Mirrors
  the existing `/activity` page markup.
- Deal nav (`deals/[id]/page.tsx`): add `<Link href={\`/deals/${id}/agent-activity\`}>Agent
  activity</Link>` alongside the existing Documents link.

## 6. Compliance / PII (hard rule #3)

The timeline renders only the action label + curated safe detail (whitelisted enum/token/count
fields) + `occurredAt` — never raw metadata. Audit metadata is PII-safe by policy; the curated
rendering is defense in depth.

## 7. Testing

- **`describe-audit-event.test.ts`** (the substance): known actions → expected labels;
  `deal.status_changed` → `from → to` detail; `docgen.generated` → `N documents`; channel/touch
  details; unknown action → humanized fallback + `null` detail; **PII-safety**: a detail builder fed
  hostile extra metadata (e.g. `{ from, to, borrowerName: 'Jane Doe' }`) returns only the whitelisted
  substring (never the name).
- **`deal-agent-activity.test.ts`** (Neon-gated, skip-green): seed deal + audit events (deal-scoped +
  a non-deal event) → loader returns only the deal-scoped events, newest first; cross-org RLS
  isolation. (Mirrors the established Neon integration pattern + unique UUID namespace.)

Target: ~12 tests. **0 migrations.** No new package (apps/web only).

## 8. File structure

```text
apps/web/lib/agent-activity/
  describe-audit-event.ts
  describe-audit-event.test.ts
apps/web/lib/queries/
  deal-agent-activity.ts
apps/web/app/(app)/deals/[id]/agent-activity/
  page.tsx
apps/web/app/(app)/deals/[id]/page.tsx          # + Agent activity nav link
apps/web/tests/integration/
  deal-agent-activity.test.ts                   # Neon-gated, skip-green
```
