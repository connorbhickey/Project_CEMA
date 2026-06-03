import { Card } from '@cema/ui';
import Link from 'next/link';

import { activityParams } from '@/lib/agent-activity/activity-href';
import { type AgentStatCard } from '@/lib/dashboard/agent-activity-summary';
import { statCardLink } from '@/lib/dashboard/stat-card-link';

function CardBody({ card, active }: { card: AgentStatCard; active: boolean }) {
  return (
    <Card className={`h-full p-4 ${active ? 'ring-foreground ring-2' : ''}`}>
      <div className="text-foreground text-2xl font-semibold tabular-nums">{card.count}</div>
      <div className="text-foreground text-sm font-medium">{card.label}</div>
      <div className="text-muted-foreground text-xs">
        {card.unit === 'open' ? 'open' : 'actions'}
      </div>
    </Card>
  );
}

function StatCard({
  card,
  activeAgent,
  activeSince,
}: {
  card: AgentStatCard;
  activeAgent: string | null;
  activeSince: string | null;
}) {
  const link = statCardLink(card.key);
  const body = <CardBody card={card} active={link?.kind === 'agent' && card.key === activeAgent} />;
  if (!link) return body;

  const className = 'block transition-opacity hover:opacity-80';
  if (link.kind === 'exceptions') {
    return (
      <Link href="/exceptions" className={className}>
        {body}
      </Link>
    );
  }
  // An agent (or Lifecycle) card drills into the feed, preserving the active
  // time window, and scrolls to the feed section.
  return (
    <Link
      href={{
        pathname: '/dashboard',
        query: activityParams({ agent: link.agentKey, since: activeSince }),
        hash: 'recent-activity',
      }}
      className={className}
    >
      {body}
    </Link>
  );
}

export function AgentStatCards({
  cards,
  activeAgent,
  activeSince,
}: {
  cards: AgentStatCard[];
  activeAgent: string | null;
  activeSince: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <StatCard key={c.key} card={c} activeAgent={activeAgent} activeSince={activeSince} />
      ))}
    </div>
  );
}
