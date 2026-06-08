import { OrgProfile } from '@/components/settings/org-profile';

export default function Page() {
  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      <div className="mb-5">
        <h1 className="text-foreground text-2xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage your organization.</p>
      </div>
      <OrgProfile />
    </div>
  );
}
