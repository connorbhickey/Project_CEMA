import { ThemeToggle } from '@cema/ui';
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { Layers } from 'lucide-react';
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
    <div className="flex min-h-screen flex-col">
      <header className="bg-brand-navy-header flex h-14 items-center justify-between px-4 text-white">
        <div className="flex items-center gap-2.5">
          <div className="bg-brand-teal-bright flex h-8 w-8 items-center justify-center rounded-lg">
            <Layers className="text-brand-navy h-[18px] w-[18px]" strokeWidth={2.2} />
          </div>
          <span className="text-[15px] font-bold tracking-tight text-white">Project_CEMA</span>
        </div>
        <div className="flex items-center gap-3">
          <OrganizationSwitcher
            appearance={{ elements: { organizationSwitcherTrigger: 'text-white' } }}
          />
          <ThemeToggle />
          <UserButton />
        </div>
      </header>
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
