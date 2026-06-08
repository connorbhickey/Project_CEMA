import { Layers } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-muted flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      {/* Brand lockup — mirrors the in-app navy header logomark */}
      <div className="flex items-center gap-2.5">
        <div className="bg-brand-teal-bright flex h-10 w-10 items-center justify-center rounded-xl">
          <Layers className="text-brand-navy h-[22px] w-[22px]" strokeWidth={2.2} />
        </div>
        <span className="text-foreground text-xl font-extrabold tracking-tight">Project_CEMA</span>
      </div>

      {children}

      <p className="text-muted-foreground text-[12px]">
        Attorney-supervised CEMA processing · New York State
      </p>
    </main>
  );
}
