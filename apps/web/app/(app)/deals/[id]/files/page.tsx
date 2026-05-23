import { DriveFileCard } from '@/components/drive-file-card';
import { listDriveFiles } from '@/lib/actions/list-drive-files';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;
  const files = await listDriveFiles(dealId);

  const linked = files.filter((f) => f.dealId === dealId);
  const inbox = files.filter((f) => f.dealId === null);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Files</h1>

      {linked.length === 0 && inbox.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No files yet</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Files synced from Google Drive will appear here once a Drive folder is linked to this
            deal.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {linked.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-medium">Linked to deal</h2>
              <ul className="space-y-2" role="list">
                {linked.map((f) => (
                  <li key={f.id}>
                    <DriveFileCard file={f} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {inbox.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-medium">Inbox (un-linked)</h2>
              <ul className="space-y-2" role="list">
                {inbox.map((f) => (
                  <li key={f.id}>
                    <DriveFileCard file={f} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
