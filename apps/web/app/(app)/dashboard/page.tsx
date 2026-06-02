import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { toOrgActivityItem } from '@/lib/agent-activity/org-activity-item';
import { getOrgAgentActivity } from '@/lib/queries/org-agent-activity';

export default async function DashboardPage() {
  const rows = await getOrgAgentActivity();
  const items = rows.map(toOrgActivityItem);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Dashboard</h1>
      <h2 className="text-muted-foreground mb-4 text-sm font-medium">Recent agent activity</h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Agent activity will appear here as deals move through the pipeline.
        </p>
      ) : (
        <ol className="border-border relative space-y-6 border-l">
          {items.map((item) => (
            <li key={item.id} className="ml-4">
              <span className="border-background bg-muted absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border" />
              <Link href={`/deals/${item.dealId}`} className="hover:underline">
                <p className="text-foreground text-sm font-medium">{item.label}</p>
              </Link>
              {item.detail && (
                <p className="text-muted-foreground max-w-md truncate text-sm">{item.detail}</p>
              )}
              <p className="text-muted-foreground text-xs">{item.context}</p>
              <time className="text-muted-foreground text-xs">
                {formatDistanceToNow(item.occurredAt, { addSuffix: true })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
