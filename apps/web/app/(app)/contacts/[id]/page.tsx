import { notFound } from 'next/navigation';

import { ContactDetail } from '@/components/contact-detail';
import { getContact } from '@/lib/actions/get-contact';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getContact(id);
  if (!data) notFound();
  return <ContactDetail contact={data.contact} identities={data.identities} />;
}
