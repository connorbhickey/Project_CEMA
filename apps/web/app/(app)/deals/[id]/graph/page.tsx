import { GitFork, Link2, Share2 } from 'lucide-react';

import { BentoCard, CardEmptyState } from '@/components/deal-hub/bento-card';
import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
import { getDealGraph } from '@/lib/actions/get-deal-graph';
import { summarizeDealGraph } from '@/lib/kg/deal-graph-view';

export default async function DealGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { edges } = await getDealGraph(id);
  const { groups, chainPath } = summarizeDealGraph(edges);

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={id} active="graph" />

      {edges.length === 0 ? (
        <BentoCard
          icon={<Share2 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" strokeWidth={2} />}
          iconTile="bg-cyan-500/10"
          title="Knowledge graph"
        >
          <CardEmptyState>
            No relationships yet. They appear as the deal&apos;s collateral is processed (the IDP
            classifies instruments and the chain of title is analyzed).
          </CardEmptyState>
        </BentoCard>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {chainPath.length > 0 ? (
            <BentoCard
              icon={<Link2 className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />}
              iconTile="bg-teal-500/10"
              title="Assignment chain"
            >
              <ol className="flex flex-wrap items-center gap-2">
                {chainPath.map((docId, i) => (
                  <li key={docId} className="flex items-center gap-2">
                    {i > 0 ? <span className="text-muted-foreground">→</span> : null}
                    <span className="bg-muted text-foreground rounded-lg px-2.5 py-1 font-mono text-[11.5px]">
                      {docId}
                    </span>
                  </li>
                ))}
              </ol>
            </BentoCard>
          ) : null}

          {groups.map((group) => (
            <BentoCard
              key={group.predicate}
              icon={<GitFork className="h-4 w-4 text-sky-600 dark:text-sky-400" strokeWidth={2} />}
              iconTile="bg-sky-500/10"
              title={`${group.label} (${group.edges.length})`}
            >
              <ul className="space-y-1.5">
                {group.edges.map((e) => (
                  <li
                    key={`${e.subjectId}:${e.predicate}:${e.objectId}`}
                    className="bg-muted text-foreground rounded-lg px-2.5 py-1.5 font-mono text-[11.5px]"
                  >
                    {e.subjectId} <span className="text-muted-foreground">→</span> {e.objectId}
                  </li>
                ))}
              </ul>
            </BentoCard>
          ))}
        </div>
      )}
    </div>
  );
}
