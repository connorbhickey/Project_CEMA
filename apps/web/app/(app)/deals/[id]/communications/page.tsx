import { notFound } from 'next/navigation';

import { CommunicationCard } from '@/components/communication-card';
import { listCommunications } from '@/lib/actions/list-communications';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comms = await listCommunications(id);

  if (comms === null) notFound();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Communications</h1>

      {comms.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No calls yet</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Use the Call button on a party to initiate your first outbound call.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" role="list" aria-label="Communications list">
          {comms.map((comm) => (
            <li key={comm.id}>
              <CommunicationCard comm={comm} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
