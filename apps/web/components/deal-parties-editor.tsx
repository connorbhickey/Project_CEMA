'use client';

import { useState, useTransition } from 'react';

import { addDealParty, removeDealParty, updateDealParty } from '@/lib/actions/manage-deal-parties';
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
              <PartyRow key={p.id} dealId={dealId} party={p} />
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

function PartyRow({ dealId, party }: { dealId: string; party: DealParty }) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState(party.role);
  const [fullName, setFullName] = useState(party.fullName ?? '');
  const [email, setEmail] = useState(party.email ?? '');
  const [phone, setPhone] = useState(party.phone ?? '');

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await updateDealParty({ dealId, partyId: party.id, role, fullName, email, phone });
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update party');
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      try {
        await removeDealParty({ dealId, partyId: party.id });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to remove party');
      }
    });
  }

  if (editing) {
    return (
      <li className="rounded-lg border p-3 text-sm">
        <div className="flex flex-wrap items-end gap-3">
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
              className={inputClass}
              aria-label="Full name"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              aria-label="Email"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Phone</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
              aria-label="Phone"
            />
          </label>
          <button
            type="button"
            disabled={isPending || fullName.trim().length === 0}
            onClick={handleSave}
            className="inline-flex items-center rounded-md border bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
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
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm">
      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">
        {partyRoleLabel(party.role)}
      </span>
      <span className="font-medium">{party.fullName ?? '—'}</span>
      {party.email ? <span className="text-muted-foreground text-xs">{party.email}</span> : null}
      {party.phone ? <span className="text-muted-foreground text-xs">{party.phone}</span> : null}
      <div className="ml-auto flex gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => setEditing(true)}
          className="text-muted-foreground text-xs hover:text-blue-700 disabled:opacity-50"
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
