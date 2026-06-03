import { getDealGraph } from '../../../../../lib/actions/get-deal-graph';
import { summarizeDealGraph } from '../../../../../lib/kg/deal-graph-view';

export default async function DealGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { edges } = await getDealGraph(id);
  const { groups, chainPath } = summarizeDealGraph(edges);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Knowledge Graph — Deal {id}</h1>

      {edges.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No relationships yet. They appear as the deal&apos;s collateral is processed (the IDP
          classifies instruments and the chain of title is analyzed).
        </p>
      )}

      {chainPath.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-2 text-sm font-medium uppercase tracking-wide">
            Assignment chain
          </h2>
          <ol className="flex flex-wrap items-center gap-2">
            {chainPath.map((docId, i) => (
              <li key={docId} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground">→</span>}
                <span className="bg-muted rounded px-3 py-1 font-mono text-sm">{docId}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.predicate}>
          <h2 className="text-muted-foreground mb-2 text-sm font-medium uppercase tracking-wide">
            {group.label} ({group.edges.length})
          </h2>
          <ul className="space-y-1">
            {group.edges.map((e) => (
              <li
                key={`${e.subjectId}:${e.predicate}:${e.objectId}`}
                className="bg-muted rounded px-3 py-1 font-mono text-sm"
              >
                {e.subjectId} <span className="text-muted-foreground">→</span> {e.objectId}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
