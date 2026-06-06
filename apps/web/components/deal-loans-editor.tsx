'use client';

import { useState, useTransition } from 'react';

import { addExistingLoan, removeExistingLoan } from '@/lib/actions/manage-deal-loans';

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
  'rounded-md border px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

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

  function handleRemove(loanId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await removeExistingLoan({ dealId, loanId });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to remove loan');
      }
    });
  }

  const sorted = [...loans].sort((a, b) => a.chainPosition - b.chainPosition);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-medium">Consolidation chain ({loans.length})</h2>
        {loans.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            No existing loans yet. Add each prior mortgage being consolidated (Schedule A).
          </div>
        ) : (
          <ul className="space-y-2" role="list">
            {sorted.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm"
              >
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">
                  #{l.chainPosition}
                </span>
                <span className="font-medium">UPB ${l.upb}</span>
                {l.investor ? (
                  <span className="text-muted-foreground text-xs">{l.investor}</span>
                ) : null}
                {(l.recordedCrfn ?? l.recordedReelPage) ? (
                  <span className="text-muted-foreground text-xs">
                    {l.recordedCrfn ?? l.recordedReelPage}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleRemove(l.id)}
                  className="text-muted-foreground ml-auto text-xs hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium">Add a prior loan</h2>
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
            className="inline-flex items-center rounded-md border bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isPending ? 'Saving…' : 'Add loan'}
          </button>
        </form>
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </section>
    </div>
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
