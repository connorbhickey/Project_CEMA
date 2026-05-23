'use client';

import { useState, useTransition } from 'react';

import { approveDocument } from '@/lib/actions/approve-document';
import { claimReview } from '@/lib/actions/claim-review';
import { rejectDocument } from '@/lib/actions/reject-document';

interface ReviewDetailPanelProps {
  queueId: string;
  state: 'pending' | 'claimed' | 'approved' | 'rejected';
  reviewerIsCurrentUser: boolean;
}

export function ReviewDetailPanel({
  queueId,
  state,
  reviewerIsCurrentUser,
}: ReviewDetailPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  function doClaim() {
    setError(null);
    startTransition(async () => {
      try {
        await claimReview(queueId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function doApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approveDocument(queueId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function doReject() {
    if (!rejectionReason.trim()) {
      setError('Rejection reason is required');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await rejectDocument(queueId, rejectionReason);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (state === 'approved') {
    return <p className="text-sm text-green-700">This document has been approved.</p>;
  }
  if (state === 'rejected') {
    return <p className="text-sm text-red-700">This document was rejected.</p>;
  }

  return (
    <div className="space-y-3">
      {state === 'pending' ? (
        <button
          type="button"
          onClick={doClaim}
          disabled={isPending}
          className="inline-flex items-center rounded-md border bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isPending ? 'Claiming…' : 'Claim review'}
        </button>
      ) : null}

      {state === 'claimed' && reviewerIsCurrentUser ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={doApprove}
            disabled={isPending}
            className="inline-flex items-center rounded-md border bg-green-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isPending ? 'Approving…' : 'Approve document'}
          </button>

          {!showRejectForm ? (
            <button
              type="button"
              onClick={() => setShowRejectForm(true)}
              className="inline-flex items-center rounded-md border bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700"
            >
              Reject&hellip;
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Reason for rejection (required)"
                rows={3}
                className="w-full rounded-md border px-2 py-1 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={doReject}
                  disabled={isPending}
                  className="inline-flex items-center rounded-md border bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {isPending ? 'Rejecting…' : 'Confirm rejection'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRejectForm(false);
                    setRejectionReason('');
                    setError(null);
                  }}
                  className="inline-flex items-center rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {state === 'claimed' && !reviewerIsCurrentUser ? (
        <p className="text-muted-foreground text-sm">Another reviewer has claimed this review.</p>
      ) : null}

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
