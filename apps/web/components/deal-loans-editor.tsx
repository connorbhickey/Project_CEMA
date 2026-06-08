'use client';

import { BookOpen, Landmark } from 'lucide-react';
import { useState, useTransition } from 'react';

import { BentoCard } from '@/components/deal-hub/bento-card';
import {
  addExistingLoan,
  removeExistingLoan,
  updateExistingLoan,
} from '@/lib/actions/manage-deal-loans';

export interface DealLoanRow {
  id: string;
  upb: string;
  chainPosition: number;
  originalPrincipal: string | null;
  investor: string | null;
  recordedReelPage: string | null;
  recordedCrfn: string | null;
}

const inputClass =
  'border-border bg-card rounded-md border px-3 py-1.5 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring';

export function DealLoansEditor({ dealId, loans }: { dealId: string; loans: DealLoanRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const nextPosition = loans.reduce((max, l) => Math.max(max, l.chainPosition + 1), 0);

  const [upb, setUpb] = useState('');
  const [chainPosition, setChainPosition] = useState(String(nextPosition));
  const [originalPrincipal, setOriginalPrincipal] = useState('');
  const [investor, setInvestor] = useState('');
  const [recordedReelPage, setRecordedReelPage] = useState('');
  const [recordedCrfn, setRecordedCrfn] = useState('');

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      try {
        await addExistingLoan(dealId, {
          upb,
          chainPosition,
          originalPrincipal,
          investor,
          recordedReelPage,
          recordedCrfn,
        });
        setUpb('');
        setOriginalPrincipal('');
        setInvestor('');
        setRecordedReelPage('');
        setRecordedCrfn('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to add loan');
      }
    });
  }

  const sorted = [...loans].sort((a, b) => a.chainPosition - b.chainPosition);

  return (
    <div className="space-y-3">
      <BentoCard
        icon={<BookOpen className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />}
        iconTile="bg-teal-500/10"
        title={`Consolidation chain (${loans.length})`}
      >
        {loans.length === 0 ? (
          <div className="text-muted-foreground border-border rounded-lg border border-dashed p-8 text-center text-sm">
            No existing loans yet. Add each prior mortgage being consolidated (Schedule A).
          </div>
        ) : (
          <ul className="space-y-2" role="list">
            {sorted.map((l) => (
              <LoanRow key={l.id} dealId={dealId} loan={l} />
            ))}
          </ul>
        )}
      </BentoCard>

      <BentoCard
        icon={<Landmark className="h-4 w-4 text-cyan-600 dark:text-cyan-400" strokeWidth={2} />}
        iconTile="bg-cyan-500/10"
        title="Add a prior loan"
      >
        <p className="text-muted-foreground mb-3 text-xs">
          UPB is the unpaid principal balance (the §255 tax-exempt portion). Provide a reel/page
          (upstate) <em>or</em> a CRFN (NYC), not both.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <Field label="UPB" value={upb} onChange={setUpb} required inputMode="decimal" />
          <Field
            label="Chain position"
            value={chainPosition}
            onChange={setChainPosition}
            required
            inputMode="numeric"
          />
          <Field
            label="Original principal"
            value={originalPrincipal}
            onChange={setOriginalPrincipal}
            inputMode="decimal"
          />
          <Field label="Investor" value={investor} onChange={setInvestor} />
          <Field label="Reel/Page" value={recordedReelPage} onChange={setRecordedReelPage} />
          <Field label="CRFN" value={recordedCrfn} onChange={setRecordedCrfn} />
          <button
            type="submit"
            disabled={isPending || upb.trim().length === 0}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Add loan'}
          </button>
        </form>
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </BentoCard>
    </div>
  );
}

function LoanRow({ dealId, loan }: { dealId: string; loan: DealLoanRow }) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upb, setUpb] = useState(loan.upb);
  const [chainPosition, setChainPosition] = useState(String(loan.chainPosition));
  const [originalPrincipal, setOriginalPrincipal] = useState(loan.originalPrincipal ?? '');
  const [investor, setInvestor] = useState(loan.investor ?? '');
  const [recordedReelPage, setRecordedReelPage] = useState(loan.recordedReelPage ?? '');
  const [recordedCrfn, setRecordedCrfn] = useState(loan.recordedCrfn ?? '');

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await updateExistingLoan(dealId, loan.id, {
          upb,
          chainPosition,
          originalPrincipal,
          investor,
          recordedReelPage,
          recordedCrfn,
        });
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update loan');
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      try {
        await removeExistingLoan({ dealId, loanId: loan.id });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to remove loan');
      }
    });
  }

  if (editing) {
    return (
      <li className="border-border rounded-lg border p-3 text-sm">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="UPB" value={upb} onChange={setUpb} required inputMode="decimal" />
          <Field
            label="Chain position"
            value={chainPosition}
            onChange={setChainPosition}
            required
            inputMode="numeric"
          />
          <Field
            label="Original principal"
            value={originalPrincipal}
            onChange={setOriginalPrincipal}
            inputMode="decimal"
          />
          <Field label="Investor" value={investor} onChange={setInvestor} />
          <Field label="Reel/Page" value={recordedReelPage} onChange={setRecordedReelPage} />
          <Field label="CRFN" value={recordedCrfn} onChange={setRecordedCrfn} />
          <button
            type="button"
            disabled={isPending || upb.trim().length === 0}
            onClick={handleSave}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="text-muted-foreground text-sm hover:underline disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </li>
    );
  }

  return (
    <li className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm">
      <span className="rounded-full bg-slate-400/10 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
        #{loan.chainPosition}
      </span>
      <span className="font-mono font-medium tabular-nums">UPB ${loan.upb}</span>
      {loan.investor ? (
        <span className="text-muted-foreground text-xs">{loan.investor}</span>
      ) : null}
      {(loan.recordedCrfn ?? loan.recordedReelPage) ? (
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {loan.recordedCrfn ?? loan.recordedReelPage}
        </span>
      ) : null}
      <div className="ml-auto flex gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => setEditing(true)}
          className="text-muted-foreground text-xs hover:text-teal-700 disabled:opacity-50 dark:hover:text-teal-400"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleRemove}
          className="text-muted-foreground text-xs hover:text-red-700 disabled:opacity-50"
        >
          Remove
        </button>
      </div>
      {error ? <span className="w-full text-xs text-red-700">{error}</span> : null}
    </li>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">
        {label}
        {required ? '' : ' (optional)'}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        inputMode={inputMode}
        aria-label={label}
        className={inputClass}
      />
    </label>
  );
}
