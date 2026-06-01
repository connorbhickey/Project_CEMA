'use client';

import type { ChainBreakReviewState } from '@cema/attorney';
import { useState, useTransition } from 'react';

import { transitionChainBreakReview } from '@/lib/actions/transition-chain-break-review';

interface Props {
  // null when the chain break is detected live but the actuator has not yet
  // enqueued a row (transient — the actuator auto-enqueues on the next run).
  queueId: string | null;
  state: ChainBreakReviewState | null;
}

export function DealChainBreakReviewActions({ queueId, state }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  if (queueId === null || state === null) {
    return <p className="text-muted-foreground text-xs">Pending enqueue…</p>;
  }

  if (state === 'resolved') {
    return <p className="text-xs text-green-700">Resolved.</p>;
  }
  if (state === 'dismissed') {
    return <p className="text-xs text-gray-600">Dismissed.</p>;
  }

  const run = (toState: ChainBreakReviewState) => {
    setError(null);
    startTransition(async () => {
      try {
        await transitionChainBreakReview(queueId, toState, note.trim() || undefined);
        setNote('');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {state === 'pending' ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run('claimed')}
            className="inline-flex items-center rounded-md border bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isPending ? 'Claiming…' : 'Claim'}
          </button>
        ) : null}

        {state === 'claimed' ? (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run('resolved')}
              className="inline-flex items-center rounded-md border bg-green-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {isPending ? 'Saving…' : 'Resolve'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run('dismissed')}
              className="inline-flex items-center rounded-md border bg-gray-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {isPending ? 'Saving…' : 'Dismiss'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run('pending')}
              className="inline-flex items-center rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              Release
            </button>
          </>
        ) : null}
      </div>

      {state === 'claimed' ? (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (resolve / dismiss)"
          className="w-full rounded-md border px-2 py-1 text-xs"
        />
      ) : null}

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
