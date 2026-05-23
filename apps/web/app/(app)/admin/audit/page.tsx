import { AuditEventRow } from '@/components/audit-event-row';
import { listAuditEventReads } from '@/lib/actions/list-audit-events-reads';

interface PageProps {
  searchParams: Promise<{ entity?: string; days?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const entityType = (params.entity ?? undefined) as
    | 'communication'
    | 'document'
    | 'recording'
    | 'pii_field'
    | 'contact'
    | 'deal'
    | 'envelope'
    | undefined;
  const sinceDays = params.days ? Number(params.days) : 7;
  const rows = await listAuditEventReads({ entityType, sinceDays, limit: 200 });

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Audit log — read access</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Showing last {sinceDays} day{sinceDays === 1 ? '' : 's'}
        {entityType ? ` · entity type: ${entityType}` : ''}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No read events in window</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-3 px-3 text-xs font-medium uppercase text-gray-500">
            <span className="col-span-2">When</span>
            <span className="col-span-3">Actor</span>
            <span className="col-span-2">Purpose</span>
            <span className="col-span-2">Entity</span>
            <span className="col-span-3">Entity ID</span>
          </div>
          {rows.map((r) => (
            <AuditEventRow key={r.read.id} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}
