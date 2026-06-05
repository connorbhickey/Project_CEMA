import {
  ANCHOR_KINDS,
  ASSIGNMENT_KINDS,
  CONSOLIDATION_KINDS,
  NOTE_KINDS,
  RECORDED_KINDS,
} from './types';
import type {
  ChainAnalysis,
  ChainBreak,
  ChainEdge,
  ChainSequenceEdge,
  ChainStatus,
  InstrumentRecord,
} from './types';

const ANCHOR_SET = new Set<string>(ANCHOR_KINDS);
const NOTE_SET = new Set<string>(NOTE_KINDS);
const ASSIGNMENT_SET = new Set<string>(ASSIGNMENT_KINDS);
const RECORDED_SET = new Set<string>(RECORDED_KINDS);
const CONSOLIDATION_SET = new Set<string>(CONSOLIDATION_KINDS);

// An instrument is "recorded" if it carries either a reel/page (upstate) or a
// CRFN (NYC ACRIS). A RECORDED_KINDS instrument with neither is unrecorded.
function isRecorded(inst: InstrumentRecord): boolean {
  return inst.recordingRef.reelPage !== null || inst.recordingRef.crfn !== null;
}

// Normalize a recording reference for comparison: trim, collapse internal
// whitespace, lowercase. Absorbs incidental formatting differences between how a
// ref is written in `recordingRef` vs cited in another instrument's `references`
// WITHOUT parsing structure -- high precision, no fuzzy matching.
function normRef(ref: string): string {
  return ref.trim().replace(/\s+/g, ' ').toLowerCase();
}

// The set of normalized recording references actually present in the deal: every
// non-null reel/page and CRFN across all instruments. Used by pass F to confirm
// each cited reference resolves to a recorded instrument in the collateral file.
function presentRefKeys(instruments: readonly InstrumentRecord[]): Set<string> {
  const keys = new Set<string>();
  for (const inst of instruments) {
    if (inst.recordingRef.reelPage !== null) keys.add(normRef(inst.recordingRef.reelPage));
    if (inst.recordingRef.crfn !== null) keys.add(normRef(inst.recordingRef.crfn));
  }
  return keys;
}

// Sort by recordedAt ascending (ISO-8601 strings sort lexically); nulls last so
// undated instruments don't masquerade as the earliest hop.
function byRecordedAt(a: InstrumentRecord, b: InstrumentRecord): number {
  if (a.recordedAt === null && b.recordedAt === null) return 0;
  if (a.recordedAt === null) return 1;
  if (b.recordedAt === null) return -1;
  return a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0;
}

// Detect a cycle in the assignor -> assignee graph via DFS three-coloring.
// Null-party hops are skipped (they can't form a definite edge). A back-edge to
// a GRAY (in-progress) node means a cycle -- a chain can never loop.
function detectCycle(assignments: readonly InstrumentRecord[]): boolean {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const a of assignments) {
    if (a.assignor === null || a.assignee === null) continue;
    color.set(a.assignor, WHITE);
    color.set(a.assignee, WHITE);
    const out = adjacency.get(a.assignor) ?? [];
    out.push(a.assignee);
    adjacency.set(a.assignor, out);
  }

  const visit = (node: string): boolean => {
    color.set(node, GRAY);
    for (const next of adjacency.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  };

  for (const node of color.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE && visit(node)) return true;
  }
  return false;
}

function toStatus(breaks: readonly ChainBreak[]): ChainStatus {
  if (breaks.length === 0) return 'clean';
  if (breaks.every((b) => b.kind === 'missing_assignment')) return 'broken';
  return 'ambiguous';
}

/**
 * Classify every break in a deal's recorded chain of title from the
 * InstrumentRecord[] the Collateral IDP persisted. PURE + deterministic: no
 * clock, no IO, no LLM. Same input -> same ChainAnalysis (durable-replay safe).
 *
 * Safety property ("never auto-bless"): the returned status is `clean` IFF
 * `breaks.length === 0`. An empty instrument set, or one with no anchor, can
 * never be `clean` -- it surfaces as `ambiguous`/`broken` for human review.
 *
 * Reference-target validation (pass F): when an instrument's `references` field
 * cites other instruments by recording reference, each cited reference is
 * confirmed present among the deal's recorded instruments; a citation with no
 * match is an `ambiguous_assignment` (a referenced instrument missing from the
 * collateral file).
 *
 * Head-gap verification (pass G): when an anchor's `originator` (the original
 * mortgagee) is known, the FIRST recorded assignment's assignor is confirmed to
 * be that lender -- a mismatch is a `missing_assignment` (an assignment at the
 * head of the chain, from the original lender to the first recorded assignor, is
 * missing). This complements the INTERNAL sequence check (assignee[n] ===
 * assignor[n+1]). Skipped when no originator is extracted, so instruments
 * without the field are unaffected.
 */
export function analyzeChain(instruments: readonly InstrumentRecord[]): ChainAnalysis {
  const breaks: ChainBreak[] = [];

  const anchors = instruments.filter((i) => ANCHOR_SET.has(i.instrumentKind));
  const notes = instruments.filter((i) => NOTE_SET.has(i.instrumentKind));
  const assignments = instruments.filter((i) => ASSIGNMENT_SET.has(i.instrumentKind));

  // (A) Per-instrument: any RECORDED_KINDS instrument missing a recording ref.
  for (const inst of instruments) {
    if (RECORDED_SET.has(inst.instrumentKind) && !isRecorded(inst)) {
      breaks.push({
        kind: 'unrecorded_instrument',
        documentId: inst.documentId,
        detail: `${inst.instrumentKind} has no recording reference`,
      });
    }
  }

  // (B) No anchor at all: every note is an orphan -> lost_note candidate.
  if (anchors.length === 0) {
    for (const note of notes) {
      breaks.push({
        kind: 'lost_note',
        documentId: note.documentId,
        detail: `note ${note.documentId} has no anchoring mortgage`,
      });
    }
  }

  // (C) Nothing to anchor on AND no notes either: the set is unanalyzable.
  if (anchors.length === 0 && notes.length === 0) {
    breaks.push({
      kind: 'ambiguous_assignment',
      documentId: null,
      detail: 'no anchor and no note present; chain cannot be established',
    });
  }

  // (D) Assignment-graph ambiguity (missing party, fork, merge, cycle).
  const ambiguousBefore = breaks.filter((b) => b.kind === 'ambiguous_assignment').length;

  // (D.1) Missing party on an assignment.
  for (const a of assignments) {
    if (a.assignor === null || a.assignee === null) {
      breaks.push({
        kind: 'ambiguous_assignment',
        documentId: a.documentId,
        detail: `assignment ${a.documentId} is missing assignor or assignee`,
      });
    }
  }

  // (D.2) Fork: one assignor with two+ distinct outgoing assignments.
  const byAssignor = new Map<string, InstrumentRecord[]>();
  for (const a of assignments) {
    if (a.assignor === null) continue;
    const group = byAssignor.get(a.assignor) ?? [];
    group.push(a);
    byAssignor.set(a.assignor, group);
  }
  for (const group of byAssignor.values()) {
    if (group.length >= 2) {
      for (const a of group) {
        breaks.push({
          kind: 'ambiguous_assignment',
          documentId: a.documentId,
          detail: `assignor has multiple outgoing assignments (fork)`,
        });
      }
    }
  }

  // (D.3) Merge: one assignee receiving two+ distinct incoming assignments.
  const byAssignee = new Map<string, InstrumentRecord[]>();
  for (const a of assignments) {
    if (a.assignee === null) continue;
    const group = byAssignee.get(a.assignee) ?? [];
    group.push(a);
    byAssignee.set(a.assignee, group);
  }
  for (const group of byAssignee.values()) {
    if (group.length >= 2) {
      for (const a of group) {
        breaks.push({
          kind: 'ambiguous_assignment',
          documentId: a.documentId,
          detail: `assignee has multiple incoming assignments (merge)`,
        });
      }
    }
  }

  // (D.4) Cycle in the assignor -> assignee graph.
  if (detectCycle(assignments)) {
    breaks.push({
      kind: 'ambiguous_assignment',
      documentId: null,
      detail: 'assignment graph contains a cycle',
    });
  }

  // (E) Sequential gap: only when the assignment graph is otherwise unambiguous
  // (no new ambiguous_assignment breaks above), check consecutive recorded hops
  // for assignee[n] === assignor[n+1]. A mismatch is a missing_assignment.
  const ambiguousAfter = breaks.filter((b) => b.kind === 'ambiguous_assignment').length;
  if (ambiguousAfter === ambiguousBefore && assignments.length > 1) {
    const ordered = [...assignments].sort(byRecordedAt);
    for (let n = 0; n < ordered.length - 1; n += 1) {
      const cur: InstrumentRecord | undefined = ordered[n];
      const next: InstrumentRecord | undefined = ordered[n + 1];
      if (cur === undefined || next === undefined) continue;
      if (cur.assignee !== next.assignor) {
        breaks.push({
          kind: 'missing_assignment',
          documentId: next.documentId,
          detail: `gap between assignment ${cur.documentId} and ${next.documentId}`,
        });
      }
    }
  }

  // (F) Reference-target validation: an instrument's `references` lists the
  // recording references of the instruments it cites -- a CEMA's consolidated
  // mortgages, an AOM citing the mortgage it assigns. A cited reference with no
  // matching recorded instrument in the deal is a real defect (a referenced
  // instrument absent from the collateral file), so it surfaces as
  // ambiguous_assignment -> attorney_review. Conservative by design: `references`
  // is read as a `;`/`,`/newline-delimited list of recording-ref tokens, and only
  // digit-bearing tokens are checked (every CRFN / reel-page carries digits), so
  // digit-free prose is ignored rather than false-flagged. Runs AFTER pass E so
  // its ambiguous breaks never suppress E's sequential-gap detection. Recording
  // refs are public identifiers, not PII (detail is never persisted -- route.ts).
  const presentRefs = presentRefKeys(instruments);
  for (const inst of instruments) {
    if (inst.references === null) continue;
    for (const raw of inst.references.split(/[;,\n]/)) {
      const token = raw.trim();
      if (token === '' || !/\d/.test(token)) continue;
      if (!presentRefs.has(normRef(token))) {
        breaks.push({
          kind: 'ambiguous_assignment',
          documentId: inst.documentId,
          detail: `instrument ${inst.documentId} references "${token}" which is not present among the deal's recorded instruments`,
        });
      }
    }
  }

  // (G) Head-gap verification: the original mortgagee is the anchor's
  // `originator`. When exactly one is known AND the assignment graph is
  // unambiguous, the FIRST recorded assignment's assignor must be that lender;
  // otherwise an assignment at the head of the chain (original lender -> first
  // recorded assignor) is missing -> missing_assignment (re_chase). Conservative:
  // no originator, or conflicting originators, skips (no false positives). detail
  // is documentId-based -- no party names (PII-safe like the other passes).
  const originators = [
    ...new Set(
      instruments.map((i) => i.originator).filter((o): o is string => o != null && o !== ''),
    ),
  ];
  if (ambiguousAfter === ambiguousBefore && assignments.length >= 1 && originators.length === 1) {
    const originator = originators[0];
    const head = [...assignments].sort(byRecordedAt)[0];
    if (originator !== undefined && head !== undefined && head.assignor !== originator) {
      breaks.push({
        kind: 'missing_assignment',
        documentId: head.documentId,
        detail: `head gap: the first recorded assignment ${head.documentId} is not assigned by the anchor's original mortgagee`,
      });
    }
  }

  // Build the directed instrument graph (spec §5.1). assigns_to edges come from
  // the assignment instruments (assignor -> assignee); consolidates edges from
  // each CEMA instrument. Edges are descriptive output -- they do NOT influence
  // `status`, which is driven solely by `breaks` (the "never auto-bless" floor).
  const edges: ChainEdge[] = [];
  for (const a of assignments) {
    edges.push({
      kind: 'assigns_to',
      documentId: a.documentId,
      assignor: a.assignor,
      assignee: a.assignee,
    });
  }
  for (const c of instruments) {
    if (CONSOLIDATION_SET.has(c.instrumentKind)) {
      edges.push({
        kind: 'consolidates',
        documentId: c.documentId,
        assignor: null,
        assignee: null,
      });
    }
  }

  return { status: toStatus(breaks), edges, breaks };
}

/**
 * PII-free doc->doc structural edges: the recorded assignment sequence. Filters
 * to assignment instruments (aom/allonge), sorts by recordedAt (the SAME order
 * analyzeChain pass E uses; nulls last), and links each consecutive pair. Returns
 * document ids only -- party names never leave the agent. Pure + deterministic.
 * Descriptive: emitted regardless of breaks (recording-order adjacency, not a
 * claim of valid succession), mirroring the ChainEdge graph.
 */
export function chainSequenceEdges(instruments: readonly InstrumentRecord[]): ChainSequenceEdge[] {
  const assignments = instruments.filter((i) => ASSIGNMENT_SET.has(i.instrumentKind));
  const ordered = [...assignments].sort(byRecordedAt);
  const edges: ChainSequenceEdge[] = [];
  for (let n = 0; n < ordered.length - 1; n += 1) {
    const cur: InstrumentRecord | undefined = ordered[n];
    const next: InstrumentRecord | undefined = ordered[n + 1];
    if (cur === undefined || next === undefined) continue;
    edges.push({ fromDocumentId: cur.documentId, toDocumentId: next.documentId });
  }
  return edges;
}
