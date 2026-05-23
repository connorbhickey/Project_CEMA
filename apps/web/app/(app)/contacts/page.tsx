import { ContactCard } from '@/components/contact-card';
import { listContacts } from '@/lib/actions/list-contacts';

export default async function Page() {
  const rows = await listContacts();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Contacts</h1>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No contacts yet</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Contacts are extracted from parties, calls, emails, and Slack messages.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" role="list" aria-label="Contacts list">
          {rows.map(({ contact, identityCount }) => (
            <li key={contact.id}>
              <ContactCard contact={contact} identityCount={identityCount} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
