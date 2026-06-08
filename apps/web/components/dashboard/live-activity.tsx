import { formatDistanceToNow } from 'date-fns';
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

import { type OrgActivityItem } from '@/lib/agent-activity/org-activity-item';

const AGENT_META: Record<string, { icon: LucideIcon; tint: string; iconColor: string }> = {
  intake: { icon: Inbox, tint: 'bg-teal-500/10', iconColor: 'text-teal-600 dark:text-teal-400' },
  outreach: { icon: Send, tint: 'bg-blue-500/10', iconColor: 'text-blue-600 dark:text-blue-400' },
  idp: { icon: ScanText, tint: 'bg-cyan-500/10', iconColor: 'text-cyan-600 dark:text-cyan-400' },
  chain: { icon: Link2, tint: 'bg-sky-500/10', iconColor: 'text-sky-600 dark:text-sky-400' },
  docgen: { icon: FileText, tint: 'bg-teal-500/10', iconColor: 'text-teal-600 dark:text-teal-400' },
  recording: { icon: Stamp, tint: 'bg-blue-500/10', iconColor: 'text-blue-600 dark:text-blue-400' },
  internal_comm: {
    icon: MessageSquare,
    tint: 'bg-cyan-500/10',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
  },
  borrower_comm: {
    icon: MailCheck,
    tint: 'bg-sky-500/10',
    iconColor: 'text-sky-600 dark:text-sky-400',
  },
  exception: {
    icon: TriangleAlert,
    tint: 'bg-rose-500/10',
    iconColor: 'text-rose-600 dark:text-rose-400',
  },
  deal: {
    icon: Activity,
    tint: 'bg-slate-500/10',
    iconColor: 'text-slate-600 dark:text-slate-400',
  },
};
const FALLBACK_META = {
  icon: Activity,
  tint: 'bg-slate-500/10',
  iconColor: 'text-slate-600 dark:text-slate-400',
};

interface LiveActivityProps {
  items: OrgActivityItem[];
}

export function LiveActivity({ items }: LiveActivityProps) {
  if (items.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        Agent activity will appear here as deals move through the pipeline.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {items.slice(0, 8).map((item) => {
        const agentKey = detectAgentKey(item.label);
        const meta = AGENT_META[agentKey] ?? FALLBACK_META;
        const Icon = meta.icon;

        return (
          <div key={item.id} className="border-border flex gap-2.5 border-b py-2.5 last:border-b-0">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}
            >
              <Icon className={`h-3.5 w-3.5 ${meta.iconColor}`} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <Link href={`/deals/${item.dealId}`} className="hover:underline">
                <p className="text-foreground text-[12.5px] font-medium leading-snug">
                  {item.label}
                </p>
              </Link>
              {item.detail && (
                <p className="text-muted-foreground truncate text-[11px]">{item.detail}</p>
              )}
              <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
                {item.dealId.slice(0, 13)}… <span className="text-muted-foreground/70">·</span>{' '}
                {formatDistanceToNow(item.occurredAt, { addSuffix: true })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Map a human label to an agent key by keyword presence
function detectAgentKey(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('intake') || l.includes('deal created') || l.includes('eligibility'))
    return 'intake';
  if (l.includes('outreach') || l.includes('servicer')) return 'outreach';
  if (l.includes('collateral idp') || l.includes('collateral documents') || l.includes('idp'))
    return 'idp';
  if (l.includes('chain')) return 'chain';
  if (
    l.includes('doc gen') ||
    l.includes('cema documents') ||
    l.includes('docgen') ||
    l.includes('doc generation')
  )
    return 'docgen';
  if (l.includes('recording')) return 'recording';
  if (l.includes('internal')) return 'internal_comm';
  if (l.includes('borrower')) return 'borrower_comm';
  if (l.includes('exception') || l.includes('dispatch failed')) return 'exception';
  return 'deal';
}
