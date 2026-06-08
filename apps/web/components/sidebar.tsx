'use client';

import { cn } from '@cema/ui';
import type { LucideIcon } from 'lucide-react';
import { Folder, LayoutDashboard, Link2, Settings, TriangleAlert, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV: { href: Route; label: string; icon: LucideIcon }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/deals', label: 'Deals', icon: Folder },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/attorney/chain-queue', label: 'Chain reviews', icon: Link2 },
  { href: '/exceptions', label: 'Exceptions', icon: TriangleAlert },
  { href: '/settings/org', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="bg-sidebar border-sidebar-border w-56 border-r p-3">
      <nav className="space-y-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
