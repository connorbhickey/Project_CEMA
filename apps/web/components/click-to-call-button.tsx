'use client';

import { useState, useTransition } from 'react';

import { initiateOutboundCall } from '@/lib/actions/initiate-outbound-call';
import { TcpaConsentMissingError } from '@/lib/compliance/tcpa-guard';

export interface ClickToCallButtonProps {
  dealId: string;
  partyId: string;
  partyName: string;
  phone: string;
}

export function ClickToCallButton({ dealId, partyId, partyName, phone }: ClickToCallButtonProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCall() {
    setError(null);
    startTransition(async () => {
      try {
        await initiateOutboundCall({ dealId, partyId });
        setOpen(false);
      } catch (e) {
        if (e instanceof TcpaConsentMissingError) {
          setError('TCPA opt-in required before calling this borrower. Record consent first.');
        } else {
          setError(e instanceof Error ? e.message : 'Failed to initiate call');
        }
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        Call
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="call-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h2 id="call-modal-title" className="text-base font-semibold">
              Call {partyName}
            </h2>
            <p className="mt-1 text-sm text-gray-600">{phone}</p>

            <div className="mt-4 flex items-center gap-2">
              {/* Hard rule #5: recording is mandatory; toggle is disabled */}
              <input
                type="checkbox"
                id="record-toggle"
                checked
                disabled
                aria-label="Record this call"
                className="h-4 w-4 rounded border-gray-300"
              />
              <label htmlFor="record-toggle" className="text-sm text-gray-700">
                Record this call (required)
              </label>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCall}
                disabled={isPending}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isPending ? 'Calling…' : 'Call'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
