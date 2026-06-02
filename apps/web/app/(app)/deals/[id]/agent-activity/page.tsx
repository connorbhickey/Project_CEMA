import { formatDistanceToNow } from 'date-fns';

import { describeAuditEvent } from '@/lib/agent-activity/describe-audit-event';
import { getDealAgentActivity } from '@/lib/queries/deal-agent-activity';

export default async function DealAgentActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const events = await getDealAgentActivity(id);

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Agent activity</h2>
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No agent activity yet.</p>
      ) : (
        <ol className="border-border relative space-y-6 border-l">
          {events.map((event) => {
            const { label, detail } = describeAuditEvent(event.action, event.metadata);
            return (
              <li key={event.id} className="ml-4">
                <span className="border-background bg-muted absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border" />
                <p className="text-foreground text-sm font-medium">{label}</p>
                {detail && (
                  <p className="text-muted-foreground max-w-md truncate text-sm">{detail}</p>
                )}
                <time className="text-muted-foreground text-xs">
                  {formatDistanceToNow(event.occurredAt, { addSuffix: true })}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
