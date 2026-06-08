import {
  Activity,
  FileText,
  Inbox,
  Link2,
  type LucideIcon,
  MailCheck,
  MessageSquare,
  ScanText,
  Send,
  Stamp,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';

import { activityParams } from '@/lib/agent-activity/activity-href';
import { type AgentStatCard } from '@/lib/dashboard/agent-activity-summary';
import { statCardLink } from '@/lib/dashboard/stat-card-link';

const META: Record<
  string,
  { icon: LucideIcon; tint: string; iconColor: string; description: string }
> = {
  intake: {
    icon: Inbox,
    tint: 'bg-teal-500/10',
    iconColor: 'text-teal-600 dark:text-teal-400',
    description: 'eligibility · savings',
  },
  outreach: {
    icon: Send,
    tint: 'bg-blue-500/10',
    iconColor: 'text-blue-600 dark:text-blue-400',
    description: 'collateral chase',
  },
  idp: {
    icon: ScanText,
    tint: 'bg-cyan-500/10',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    description: 'classify · extract',
  },
  chain: {
    icon: Link2,
    tint: 'bg-sky-500/10',
    iconColor: 'text-sky-600 dark:text-sky-400',
    description: 'validate chain',
  },
  docgen: {
    icon: FileText,
    tint: 'bg-teal-500/10',
    iconColor: 'text-teal-600 dark:text-teal-400',
    description: 'draft package',
  },
  recording: {
    icon: Stamp,
    tint: 'bg-blue-500/10',
    iconColor: 'text-blue-600 dark:text-blue-400',
    description: 'ACRIS · county',
  },
  internal_comm: {
    icon: MessageSquare,
    tint: 'bg-cyan-500/10',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    description: 'pipeline channel',
  },
  borrower_comm: {
    icon: MailCheck,
    tint: 'bg-sky-500/10',
    iconColor: 'text-sky-600 dark:text-sky-400',
    description: 'borrower email',
  },
  exception: {
    icon: TriangleAlert,
    tint: 'bg-amber-500/10',
    iconColor: 'text-amber-600 dark:text-amber-400',
    description: 'triage · route',
  },
  lifecycle: {
    icon: Activity,
    tint: 'bg-slate-500/10',
    iconColor: 'text-slate-600 dark:text-slate-400',
    description: 'deal events',
  },
};
const FALLBACK = {
  icon: Activity,
  tint: 'bg-slate-500/10',
  iconColor: 'text-slate-600 dark:text-slate-400',
  description: '',
};

interface AgentFleetProps {
  cards: AgentStatCard[];
}

export function AgentFleet({ cards }: AgentFleetProps) {
  // Show the 8 named agents (not lifecycle or exception in the fleet grid)
  const fleetCards = cards.filter((c) => c.key !== 'lifecycle' && c.key !== 'exception');

  return (
    <div className="grid grid-cols-2 gap-2">
      {fleetCards.map((card) => {
        const meta = META[card.key] ?? FALLBACK;
        const Icon = meta.icon;
        const link = statCardLink(card.key);

        const inner = (
          <div className="border-border bg-muted/40 hover:border-border/80 flex items-center gap-2.5 rounded-xl border p-2.5 transition-all hover:shadow-sm">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}
            >
              <Icon className={`h-4 w-4 ${meta.iconColor}`} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-foreground text-[12.5px] font-semibold leading-tight">
                {card.label}
              </div>
              <div className="text-muted-foreground text-[11px]">{meta.description}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-foreground text-[15px] font-extrabold tabular-nums">
                {card.count.toLocaleString()}
              </div>
            </div>
          </div>
        );

        if (!link) return <div key={card.key}>{inner}</div>;

        if (link.kind === 'exceptions') {
          return (
            <Link key={card.key} href="/exceptions" className="block">
              {inner}
            </Link>
          );
        }

        return (
          <Link
            key={card.key}
            href={{
              pathname: '/dashboard',
              query: activityParams({ agent: link.agentKey, since: null }),
              hash: 'recent-activity',
            }}
            className="block"
          >
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
