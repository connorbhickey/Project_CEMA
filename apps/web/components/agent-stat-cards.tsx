import { Card } from '@cema/ui';

import { type AgentStatCard } from '@/lib/dashboard/agent-activity-summary';

export function AgentStatCards({ cards }: { cards: AgentStatCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.key} className="p-4">
          <div className="text-foreground text-2xl font-semibold tabular-nums">{c.count}</div>
          <div className="text-foreground text-sm font-medium">{c.label}</div>
          <div className="text-muted-foreground text-xs">
            {c.unit === 'open' ? 'open' : 'actions'}
          </div>
        </Card>
      ))}
    </div>
  );
}
