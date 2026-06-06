import { notFound } from 'next/navigation';

import { DealChainBreakReviewActions } from '@/components/deal-chain-break-review-actions';
import { DealDocumentReviewRow } from '@/components/deal-document-review-row';
import { getDeal } from '@/lib/actions/get-deal';
import { mergeChainReview } from '@/lib/agents/chain-of-title/merge-chain-review';
import { partitionDealDocuments } from '@/lib/deals/partition-documents';
import { getDealChainBreakReviews } from '@/lib/queries/deal-chain-break-reviews';
import { getDealChainFindings } from '@/lib/queries/deal-chain-findings';
import {
  getDealDocumentsReview,
  type DealDocumentReviewItem,
} from '@/lib/queries/deal-documents-review';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dealDetail = await getDeal(id);
  if (!dealDetail) notFound();

  const [items, findings, breakReviews] = await Promise.all([
    getDealDocumentsReview(id),
    getDealChainFindings(id),
    getDealChainBreakReviews(id),
  ]);

  // Split the deal's documents into what we RECEIVED (the prior servicer's
  // collateral file, IDP-classified) vs. what we PRODUCED (the generated CEMA
  // package) vs. other uploads, so the processor sees the two sides distinctly.
  const groups = partitionDealDocuments(items);

  const reChase = findings.routes.filter((r) => r.kind === 're_chase');
  const attorneyReview = findings.routes.filter((r) => r.kind === 'attorney_review');
  // Join live attorney_review findings to their persisted queue rows; surface
  // open rows whose break is no longer detected as orphans (manual dismissal).
  const { items: reviewItems, orphans } = mergeChainReview(attorneyReview, breakReviews);
  const hasBreaks = reChase.length > 0 || reviewItems.length > 0 || orphans.length > 0;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Documents &amp; chain of title</h1>

      {items.length === 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-medium">Documents (0)</h2>
          <div className="text-muted-foreground rounded-lg border border-dashed p-12 text-center text-sm">
            No documents on this deal yet.
          </div>
        </section>
      ) : (
        <>
          <DocumentGroup
            title="Collateral file"
            description="Instruments classified from the prior servicer's collateral file (Note, Mortgage, Assignments, Allonges)."
            items={groups.collateral}
          />
          <DocumentGroup
            title="Generated package"
            description="CEMA documents generated for this deal (Form 3172, affidavits, gap docs, cover sheets) — drafts pending attorney review."
            items={groups.generated}
          />
          <DocumentGroup
            title="Other documents"
            description="Uploaded or not-yet-classified documents."
            items={groups.other}
          />
        </>
      )}

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

            {!hasBreaks ? (
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

                {reviewItems.length > 0 ? (
                  <div>
                    <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                      Attorney review ({reviewItems.length})
                    </h3>
                    <ul className="space-y-2" role="list">
                      {reviewItems.map((item) => (
                        <li key={item.breakHash} className="rounded-lg border p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="flex-1">{item.decision.reason}</p>
                            <span className="text-muted-foreground rounded bg-gray-100 px-2 py-0.5 text-xs">
                              {item.review?.state ?? 'pending enqueue'}
                            </span>
                          </div>
                          {item.decision.documentId ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              Document: {item.decision.documentId}
                            </p>
                          ) : null}
                          <div className="mt-2">
                            <DealChainBreakReviewActions
                              queueId={item.review?.id ?? null}
                              state={item.review?.state ?? null}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {orphans.length > 0 ? (
                  <div>
                    <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                      No longer detected ({orphans.length})
                    </h3>
                    <p className="text-muted-foreground mb-2 text-xs">
                      Previously flagged breaks not present in the current chain. Dismiss after
                      confirming the underlying issue is resolved — these are never auto-closed.
                    </p>
                    <ul className="space-y-2" role="list">
                      {orphans.map((o) => (
                        <li key={o.id} className="rounded-lg border border-dashed p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex-1">{o.breakKind}</span>
                            <span className="text-muted-foreground rounded bg-gray-100 px-2 py-0.5 text-xs">
                              {o.state}
                            </span>
                          </div>
                          <div className="mt-2">
                            <DealChainBreakReviewActions queueId={o.id} state={o.state} />
                          </div>
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

/**
 * One document group (Collateral file / Generated package / Other documents).
 * Renders nothing when empty, so groups with no documents don't show a header.
 */
function DocumentGroup({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: DealDocumentReviewItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm font-medium">
        {title} ({items.length})
      </h2>
      <p className="text-muted-foreground mb-3 text-xs">{description}</p>
      <ul className="space-y-3" role="list">
        {items.map((item) => (
          <DealDocumentReviewRow key={`${item.documentId}:${item.version}`} item={item} />
        ))}
      </ul>
    </section>
  );
}
