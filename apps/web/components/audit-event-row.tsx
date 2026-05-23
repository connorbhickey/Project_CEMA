import type { AuditReadRow } from '@/lib/actions/list-audit-events-reads';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

interface AuditEventRowProps {
  row: AuditReadRow;
}

export function AuditEventRow({ row }: AuditEventRowProps) {
  const { read, actor } = row;
  return (
    <div className="grid grid-cols-12 gap-3 rounded-lg border bg-white p-3 text-xs shadow-sm">
      <span className="text-muted-foreground col-span-2">{formatDate(read.createdAt)}</span>
      <span className="col-span-3">{actor?.email ?? read.actorUserId}</span>
      <span className="col-span-2 capitalize">{read.purpose}</span>
      <span className="col-span-2 capitalize">{read.entityType}</span>
      <span className="col-span-3 font-mono text-xs">{read.entityId}</span>
    </div>
  );
}
