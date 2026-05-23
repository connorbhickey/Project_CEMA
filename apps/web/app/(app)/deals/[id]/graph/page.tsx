import { getDealGraph } from '../../../../../lib/actions/get-deal-graph';

export default async function DealGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { nodes } = await getDealGraph(id);

  const byType = nodes.reduce<Record<string, typeof nodes>>(
    (acc, node) => ({ ...acc, [node.nodeType]: [...(acc[node.nodeType] ?? []), node] }),
    {},
  );

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Knowledge Graph — Deal {id}</h1>
      {nodes.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No graph edges yet. Link contacts to parties to build the graph.
        </p>
      )}
      {Object.entries(byType).map(([type, typeNodes]) => (
        <section key={type}>
          <h2 className="text-muted-foreground mb-2 text-sm font-medium uppercase tracking-wide">
            {type}s ({typeNodes.length})
          </h2>
          <ul className="space-y-1">
            {typeNodes.map((n) => (
              <li key={n.nodeId} className="bg-muted rounded px-3 py-1 font-mono text-sm">
                {n.nodeId} <span className="text-muted-foreground">depth {n.depth}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
