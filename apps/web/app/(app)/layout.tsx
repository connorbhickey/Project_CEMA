import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { Sidebar } from '@/components/sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId } = await auth();
  if (!userId) {
    redirect('/sign-in/');
  }
  if (!orgId) {
    return (
      <main className="bg-secondary flex min-h-screen items-center justify-center">
        <div className="bg-card rounded-lg p-8 shadow-sm">
          <h1 className="mb-4 text-xl font-semibold">Create or select an organization</h1>
          <OrganizationSwitcher afterCreateOrganizationUrl="/dashboard" />
        </div>
      </main>
    );
  }
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="bg-card flex items-center justify-between border-b px-6 py-3">
          <OrganizationSwitcher />
          <UserButton />
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
