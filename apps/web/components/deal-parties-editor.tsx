'use client';

import { useState, useTransition } from 'react';

import { addDealParty, removeDealParty } from '@/lib/actions/manage-deal-parties';
import { PARTY_ROLES, partyRoleLabel } from '@/lib/deals/party-role';
import type { DealParty } from '@/lib/queries/deal-parties';

const inputClass =
  'rounded-md border px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export function DealPartiesEditor({ dealId, parties }: { dealId: string; parties: DealParty[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Defaults to `seller` — the party a Purchase CEMA needs (ADR 0019 Q4 / D2).
  const [role, setRole] = useState<string>('seller');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      try {
        await addDealParty({ dealId, role, fullName, email, phone });
        setFullName('');
        setEmail('');
        setPhone('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to add party');
      }
    });
  }

  function handleRemove(partyId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await removeDealParty({ dealId, partyId });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to remove party');
      }
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-medium">On this deal ({parties.length})</h2>
        {parties.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            No parties yet. Add the borrower (buyer) and, for a Purchase CEMA, the seller.
          </div>
        ) : (
          <ul className="space-y-2" role="list">
            {parties.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm"
              >
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">
                  {partyRoleLabel(p.role)}
                </span>
                <span className="font-medium">{p.fullName ?? '—'}</span>
                {p.email ? <span className="text-muted-foreground text-xs">{p.email}</span> : null}
                {p.phone ? <span className="text-muted-foreground text-xs">{p.phone}</span> : null}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleRemove(p.id)}
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
        <h2 className="mb-3 text-sm font-medium">Add a party</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputClass}
              aria-label="Party role"
            >
              {PARTY_ROLES.map((r) => (
                <option key={r} value={r}>
                  {partyRoleLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Full name</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className={inputClass}
              aria-label="Full name"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Email (optional)</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              aria-label="Email"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Phone (optional)</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
              aria-label="Phone"
            />
          </label>
          <button
            type="submit"
            disabled={isPending || fullName.trim().length === 0}
            className="inline-flex items-center rounded-md border bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isPending ? 'Saving…' : 'Add party'}
          </button>
        </form>
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </section>
    </div>
  );
}
