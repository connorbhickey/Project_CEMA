import { DealForm } from '@/components/deal-form';

export default function Page() {
  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">New deal</h1>
      <DealForm />
    </div>
  );
}
