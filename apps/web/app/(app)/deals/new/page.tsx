import { DealForm } from '@/components/deal-form';

export default function Page() {
  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      <div className="mb-5">
        <h1 className="text-foreground text-2xl font-extrabold tracking-tight">New deal</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Create a new CEMA deal — property, the new loan, and the existing loan being consolidated.
        </p>
      </div>
      <div className="max-w-3xl">
        <DealForm />
      </div>
    </div>
  );
}
