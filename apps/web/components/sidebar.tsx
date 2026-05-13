import type { Route } from 'next';
import Link from 'next/link';

const NAV: { href: Route; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/deals', label: 'Deals' },
  { href: '/settings/org', label: 'Settings' },
];

export function Sidebar() {
  return (
    <aside className="bg-card w-56 border-r p-4">
      <div className="mb-6 px-2 text-lg font-semibold">Project_CEMA</div>
      <nav className="space-y-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="hover:bg-accent block rounded-md px-2 py-1.5 text-sm"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
