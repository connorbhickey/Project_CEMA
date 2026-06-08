'use client';

import { OrganizationProfile } from '@clerk/nextjs';

export function OrgProfile() {
  return (
    <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
      <OrganizationProfile routing="hash" />
    </div>
  );
}
