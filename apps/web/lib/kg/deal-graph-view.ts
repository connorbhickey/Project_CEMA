/** One directed KG relationship on a deal's subgraph (a `kg_edges` row, reduced
 *  to the display fields). Ids + predicate/type enums only — PII-safe. */
export interface DealGraphEdge {
  readonly subjectId: string;
  readonly subjectType: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly objectType: string;
}

export interface DealGraphGroup {
  readonly predicate: string;
  readonly label: string;
  readonly edges: readonly DealGraphEdge[];
}

export interface DealGraphView {
  readonly groups: readonly DealGraphGroup[];
  /** The chain_precedes edges ordered into a single document path (or [] when
   *  there is no chain, or the chain has no clean head — e.g. a cycle). */
  readonly chainPath: readonly string[];
}

// Human labels per KG predicate (mirrors the @cema/kg Predicate union). An
// unlabeled predicate renders its raw token (defensive, like describeAuditEvent).
const PREDICATE_LABELS: Record<string, string> = {
  deal_has_instrument: 'Collateral instruments',
  deal_has_document: 'Documents',
  deal_has_communication: 'Communications',
  chain_precedes: 'Assignment chain (recorded order)',
  party_is_on_deal: 'Parties',
  contact_is_party: 'Contacts',
};

function predicateLabel(predicate: string): string {
  return PREDICATE_LABELS[predicate] ?? predicate;
}

/** Order chain_precedes edges into one document path. Head = a subject that is
 *  never an object; follow `from -> to`. Returns [] if there is no clean head
 *  (cycle) — descriptive, never fabricated. A self-guard stops on any revisit. */
function orderChain(chainEdges: readonly DealGraphEdge[]): string[] {
  if (chainEdges.length === 0) return [];
  const next = new Map<string, string>();
  const objects = new Set<string>();
  for (const e of chainEdges) {
    next.set(e.subjectId, e.objectId);
    objects.add(e.objectId);
  }
  const head = chainEdges.map((e) => e.subjectId).find((s) => !objects.has(s));
  if (head === undefined) return [];
  const path = [head];
  const seen = new Set<string>([head]);
  let cur = head;
  while (next.has(cur)) {
    const n = next.get(cur)!;
    if (seen.has(n)) break;
    path.push(n);
    seen.add(n);
    cur = n;
  }
  return path;
}

/**
 * Pure: reduce a deal's KG edges to a display view — grouped by predicate (in
 * first-seen order, each with a human label) + the chain_precedes sequence
 * ordered into a single document path. Node-testable; no IO.
 */
export function summarizeDealGraph(edges: readonly DealGraphEdge[]): DealGraphView {
  const groupsMap = new Map<string, DealGraphEdge[]>();
  for (const e of edges) {
    const g = groupsMap.get(e.predicate) ?? [];
    g.push(e);
    groupsMap.set(e.predicate, g);
  }
  const groups: DealGraphGroup[] = [...groupsMap.entries()].map(([predicate, es]) => ({
    predicate,
    label: predicateLabel(predicate),
    edges: es,
  }));
  const chainPath = orderChain(edges.filter((e) => e.predicate === 'chain_precedes'));
  return { groups, chainPath };
}
