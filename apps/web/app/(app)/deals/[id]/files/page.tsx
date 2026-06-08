import { FolderOpen, Inbox } from 'lucide-react';

import { BentoCard } from '@/components/deal-hub/bento-card';
import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
import { DriveFileCard } from '@/components/drive-file-card';
import { listDriveFiles } from '@/lib/actions/list-drive-files';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;
  const files = await listDriveFiles(dealId);

  const linked = files.filter((f) => f.dealId === dealId);
  const inbox = files.filter((f) => f.dealId === null);

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={dealId} active="documents" />

      <div className="mb-4">
        <h2 className="text-foreground text-lg font-bold tracking-tight">Files</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Documents synced from Google Drive for this deal.
        </p>
      </div>

      {linked.length === 0 && inbox.length === 0 ? (
        <div className="bg-card border-border rounded-2xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="bg-muted mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
              <FolderOpen className="h-6 w-6 text-teal-600 dark:text-teal-400" strokeWidth={1.5} />
            </div>
            <p className="text-foreground text-sm font-semibold">No files yet</p>
            <p className="text-muted-foreground mt-1 text-[12.5px]">
              Files synced from Google Drive will appear here once a Drive folder is linked to this
              deal.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {linked.length > 0 ? (
            <BentoCard
              icon={
                <FolderOpen className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />
              }
              iconTile="bg-teal-500/10"
              title={`Linked to deal (${linked.length})`}
            >
              <ul className="space-y-2" role="list">
                {linked.map((f) => (
                  <li key={f.id}>
                    <DriveFileCard file={f} />
                  </li>
                ))}
              </ul>
            </BentoCard>
          ) : null}

          {inbox.length > 0 ? (
            <BentoCard
              icon={
                <Inbox className="h-4 w-4 text-slate-500 dark:text-slate-400" strokeWidth={2} />
              }
              iconTile="bg-slate-500/10"
              title={`Inbox — un-linked (${inbox.length})`}
            >
              <ul className="space-y-2" role="list">
                {inbox.map((f) => (
                  <li key={f.id}>
                    <DriveFileCard file={f} />
                  </li>
                ))}
              </ul>
            </BentoCard>
          ) : null}
        </div>
      )}
    </div>
  );
}
