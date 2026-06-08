'use client';

import { Button, Input, Label } from '@cema/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { cloneElement, type ReactElement, useId, useState } from 'react';
import { useForm } from 'react-hook-form';

import { createDeal } from '@/lib/actions/create-deal';
import { createDealInputSchema, type CreateDealInput } from '@/lib/actions/create-deal-schema';

export function DealForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateDealInput>({
    resolver: zodResolver(createDealInputSchema),
    defaultValues: {
      cemaType: 'refi_cema',
      propertyType: 'one_family',
      program: 'conventional_fannie',
    },
  });

  async function onSubmit(input: CreateDealInput) {
    setError(null);
    try {
      const { id } = await createDeal(input);
      router.push(`/deals/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  return (
    <div className="bg-card border-border rounded-2xl border p-5 shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
      <form className="space-y-5" onSubmit={(e) => void handleSubmit(onSubmit)(e)}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="CEMA type" error={errors.cemaType?.message}>
            <select
              className="border-border bg-card focus:border-ring focus:ring-ring h-10 w-full rounded-md border px-3 text-sm shadow-sm focus:outline-none focus:ring-1"
              {...register('cemaType')}
            >
              <option value="refi_cema">Refi CEMA</option>
              <option value="purchase_cema">Purchase CEMA</option>
            </select>
          </Field>
          <Field label="Property type" error={errors.propertyType?.message}>
            <select
              className="border-border bg-card focus:border-ring focus:ring-ring h-10 w-full rounded-md border px-3 text-sm shadow-sm focus:outline-none focus:ring-1"
              {...register('propertyType')}
            >
              <option value="one_family">1-family</option>
              <option value="two_family">2-family</option>
              <option value="three_family">3-family</option>
              <option value="condo">Condo</option>
              <option value="pud">PUD</option>
            </select>
          </Field>
        </div>
        <Field label="Street address" error={errors.streetAddress?.message}>
          <Input {...register('streetAddress')} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Unit" error={errors.unit?.message}>
            <Input {...register('unit')} />
          </Field>
          <Field label="City" error={errors.city?.message}>
            <Input {...register('city')} />
          </Field>
          <Field label="County" error={errors.county?.message}>
            <Input {...register('county')} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="ZIP" error={errors.zipCode?.message}>
            <Input {...register('zipCode')} />
          </Field>
          <Field label="UPB (existing)" error={errors.upb?.message}>
            <Input {...register('upb')} placeholder="500000.00" />
          </Field>
          <Field label="New principal" error={errors.principal?.message}>
            <Input {...register('principal')} placeholder="700000.00" />
          </Field>
        </div>
        <Field label="Loan program" error={errors.program?.message}>
          <select
            className="border-border bg-card focus:border-ring focus:ring-ring h-10 w-full rounded-md border px-3 text-sm shadow-sm focus:outline-none focus:ring-1"
            {...register('program')}
          >
            <option value="conventional_fannie">Conventional — Fannie</option>
            <option value="conventional_freddie">Conventional — Freddie</option>
            <option value="conventional_private">Conventional — Private</option>
            <option value="jumbo">Jumbo</option>
          </select>
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating…' : 'Create deal'}
        </Button>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactElement;
}) {
  // useId() returns a stable SSR-safe id (e.g. ":r0:"). We thread the same id
  // into the Label's htmlFor and the child input's id so screen readers can
  // associate the label with the control. This fixes ADR-0001 §"Negative" #6.
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children as ReactElement<{ id?: string }>, { id })}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
