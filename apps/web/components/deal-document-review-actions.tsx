'use client';

import type { ReviewState } from '@cema/attorney';
import { useState, useTransition } from 'react';

import { ReviewDetailPanel } from './review-detail-panel';

import { submitForReview } from '@/lib/actions/submit-for-review';
import { reviewActionMode } from '@/lib/review-action-mode';

interface Props {
  documentId: string;
  attorneyReviewRequired: boolean;
  queueId: string | null;
  state: ReviewState | null;
  reviewerIsCurrentUser: boolean;
}

export function DealDocumentReviewActions({
  documentId,
  attorneyReviewRequired,
  queueId,
  state,
  reviewerIsCurrentUser,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const mode = reviewActionMode({ queueId, attorneyReviewRequired });

  if (mode === 'review' && queueId !== null && state !== null) {
    return (
      <ReviewDetailPanel
        queueId={queueId}
        state={state}
        reviewerIsCurrentUser={reviewerIsCurrentUser}
      />
    );
  }

  if (mode === 'submit') {
    return (
      <div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await submitForReview(documentId);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to submit for review');
              }
            });
          }}
          className="inline-flex items-center rounded-md border bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isPending ? 'Submitting…' : 'Submit for attorney review'}
        </button>
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </div>
    );
  }

  return null;
}
