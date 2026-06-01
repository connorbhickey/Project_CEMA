import { notFound } from 'next/navigation';

import { DealDocumentReviewActions } from '@/components/deal-document-review-actions';
import { getDeal } from '@/lib/actions/get-deal';
import { getDealChainFindings } from '@/lib/queries/deal-chain-findings';
import { getDealDocumentsReview } from '@/lib/queries/deal-documents-review';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dealDetail = await getDeal(id);
  if (!dealDetail) notFound();

  const [items, findings] = await Promise.all([
    getDealDocumentsReview(id),
    getDealChainFindings(id),
  ]);

  const reChase = findings.routes.filter((r) => r.kind === 're_chase');
  const attorneyReview = findings.routes.filter((r) => r.kind === 'attorney_review');

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Documents &amp; chain of title</h1>

      <section>
        <h2 className="mb-3 text-sm font-medium">Documents ({items.length})</h2>
        {items.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-12 text-center text-sm">
            No documents on this deal yet.
          </div>
        ) : (
          <ul className="space-y-3" role="list">
            {items.map((item) => (
              <li key={`${item.documentId}:${item.version}`} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{item.kind}</span>
                  <span className="text-muted-foreground">v{item.version}</span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{item.status}</span>
                  {item.attorneyReviewRequired ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      attorney gate
                    </span>
                  ) : null}
                  <span className="text-muted-foreground rounded px-2 py-0.5 text-xs">
                    {item.reviewState ?? '—'}
                  </span>
                </div>

                {item.attorneyReviewRequired && item.instrument ? (
                  <dl className="text-muted-foreground mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    <div className="flex gap-1">
                      <dt>Assignor → Assignee:</dt>
                      <dd className="text-foreground">
                        {item.instrument.assignor ?? '—'} → {item.instrument.assignee ?? '—'}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Amount:</dt>
                      <dd className="text-foreground">
                        {item.instrument.amount !== null ? `$${item.instrument.amount}` : '—'}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Recording:</dt>
                      <dd className="text-foreground">
                        {item.instrument.recordingRef.crfn ??
                          item.instrument.recordingRef.reelPage ??
                          '—'}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>County:</dt>
                      <dd className="text-foreground">{item.instrument.county ?? '—'}</dd>
                    </div>
                  </dl>
                ) : null}

                <div className="mt-3">
                  <DealDocumentReviewActions
                    documentId={item.documentId}
                    attorneyReviewRequired={item.attorneyReviewRequired}
                    queueId={item.queueId}
                    state={item.reviewState}
                    reviewerIsCurrentUser={item.reviewerIsCurrentUser}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Chain of title</h2>
        {!findings.analyzed ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-12 text-center text-sm">
            Not yet analyzed — no collateral instruments have been classified for this deal.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <span
                className={
                  findings.status === 'clean'
                    ? 'rounded bg-green-100 px-2 py-0.5 text-xs text-green-800'
                    : 'rounded bg-red-100 px-2 py-0.5 text-xs text-red-800'
                }
              >
                {findings.status}
              </span>
            </div>

            {reChase.length === 0 && attorneyReview.length === 0 ? (
              <p className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                No chain breaks detected.
              </p>
            ) : (
              <div className="space-y-4">
                {reChase.length > 0 ? (
                  <div>
                    <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                      Re-chase ({reChase.length})
                    </h3>
                    <ul className="space-y-2" role="list">
                      {reChase.map((r, i) => (
                        <li key={`rc-${i}`} className="rounded-lg border p-3 text-sm">
                          <p>{r.reason}</p>
                          {r.documentId ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              Document: {r.documentId}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {attorneyReview.length > 0 ? (
                  <div>
                    <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                      Attorney review ({attorneyReview.length})
                    </h3>
                    <ul className="space-y-2" role="list">
                      {attorneyReview.map((r, i) => (
                        <li key={`ar-${i}`} className="rounded-lg border p-3 text-sm">
                          <p>{r.reason}</p>
                          {r.documentId ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              Document: {r.documentId}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
