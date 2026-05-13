'use client';

import { Button, Card, CardContent, Input, Label } from '@cema/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
      router.push(`/deals/${id}` as Route);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form className="space-y-4" onSubmit={(e) => void handleSubmit(onSubmit)(e)}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="CEMA type" error={errors.cemaType?.message}>
              <select
                className="border-input bg-background h-10 w-full rounded-md border px-3"
                {...register('cemaType')}
              >
                <option value="refi_cema">Refi CEMA</option>
                <option value="purchase_cema">Purchase CEMA</option>
              </select>
            </Field>
            <Field label="Property type" error={errors.propertyType?.message}>
              <select
                className="border-input bg-background h-10 w-full rounded-md border px-3"
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
              className="border-input bg-background h-10 w-full rounded-md border px-3"
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
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
