/**
 * Deal hub — Documents & Chain of title sub-view.
 * Command Center design language: bg-muted canvas, BentoCard sections, teal/blue/cyan
 * accents. On-brand: teal / blue / cyan / sky / amber / slate / emerald.
 * No violet / indigo / purple / fuchsia. No raw hex.
 */

import { FileStack, FileText, Files, Link2 } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { DealChainBreakReviewActions } from '@/components/deal-chain-break-review-actions';
import { DealDocumentReviewRow } from '@/components/deal-document-review-row';
import { BentoCard, CardEmptyState } from '@/components/deal-hub/bento-card';
import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
import { QueueStateBadge } from '@/components/queue/queue-state-badge';
import { getDeal } from '@/lib/actions/get-deal';
import { mergeChainReview } from '@/lib/agents/chain-of-title/merge-chain-review';
import { chainBreakKindLabel } from '@/lib/chain/chain-break-labels';
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
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={id} active="documents" />

      <div className="space-y-3">
        {items.length === 0 ? (
          <BentoCard
            icon={
              <FileStack className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />
            }
            iconTile="bg-teal-500/10"
            title="Documents"
          >
            <CardEmptyState>No documents on this deal yet.</CardEmptyState>
          </BentoCard>
        ) : (
          <>
            <DocumentGroup
              title="Collateral file"
              description="Instruments classified from the prior servicer's collateral file (Note, Mortgage, Assignments, Allonges)."
              items={groups.collateral}
              icon={
                <FileStack className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />
              }
              iconTile="bg-teal-500/10"
            />
            <DocumentGroup
              title="Generated package"
              description="CEMA documents generated for this deal (Form 3172, affidavits, gap docs, cover sheets) — drafts pending attorney review."
              items={groups.generated}
              icon={
                <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" strokeWidth={2} />
              }
              iconTile="bg-blue-500/10"
            />
            <DocumentGroup
              title="Other documents"
              description="Uploaded or not-yet-classified documents."
              items={groups.other}
              icon={
                <Files className="h-4 w-4 text-slate-500 dark:text-slate-400" strokeWidth={2} />
              }
              iconTile="bg-slate-400/10"
            />
          </>
        )}

        {/* ── Chain of title ──────────────────────────────────────────── */}
        <BentoCard
          icon={<Link2 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" strokeWidth={2} />}
          iconTile="bg-cyan-500/10"
          title="Chain of title"
        >
          {!findings.analyzed ? (
            <CardEmptyState>
              Not yet analyzed — no collateral instruments have been classified for this deal.
            </CardEmptyState>
          ) : (
            <div className="space-y-4">
              {/* Status pill */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground text-[12.5px]">Status:</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    findings.status === 'clean'
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  }`}
                >
                  <span
                    className={`h-[5px] w-[5px] shrink-0 rounded-full ${
                      findings.status === 'clean' ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  {findings.status
                    ? findings.status.charAt(0).toUpperCase() + findings.status.slice(1)
                    : 'Unknown'}
                </span>
              </div>

              {!hasBreaks ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                  No chain breaks detected.
                </p>
              ) : (
                <div className="space-y-4">
                  {reChase.length > 0 ? (
                    <div>
                      <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wide">
                        Re-chase ({reChase.length})
                      </h3>
                      <ul className="space-y-2" role="list">
                        {reChase.map((r, i) => (
                          <li
                            key={`rc-${i}`}
                            className="border-border rounded-xl border p-3 text-sm"
                          >
                            <p className="text-[13px]">{r.reason}</p>
                            {r.documentId ? (
                              <p className="text-muted-foreground mt-1 text-[11.5px]">
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
                      <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wide">
                        Attorney review ({reviewItems.length})
                      </h3>
                      <ul className="space-y-2" role="list">
                        {reviewItems.map((item) => (
                          <li
                            key={item.breakHash}
                            className="border-border rounded-xl border p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="flex-1 text-[13px]">{item.decision.reason}</p>
                              {item.review?.state ? (
                                <QueueStateBadge state={item.review.state} />
                              ) : (
                                <span className="text-muted-foreground text-[11px]">
                                  pending enqueue
                                </span>
                              )}
                            </div>
                            {item.decision.documentId ? (
                              <p className="text-muted-foreground mt-1 text-[11.5px]">
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
                      <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wide">
                        No longer detected ({orphans.length})
                      </h3>
                      <p className="text-muted-foreground mb-2 text-[11.5px]">
                        Previously flagged breaks not present in the current chain. Dismiss after
                        confirming the underlying issue is resolved — these are never auto-closed.
                      </p>
                      <ul className="space-y-2" role="list">
                        {orphans.map((o) => (
                          <li
                            key={o.id}
                            className="border-border rounded-xl border border-dashed p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="flex-1 text-[13px] font-medium">
                                {chainBreakKindLabel(o.breakKind)}
                              </span>
                              <QueueStateBadge state={o.state} />
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
        </BentoCard>
      </div>
    </div>
  );
}

/**
 * One document group (Collateral file / Generated package / Other documents).
 * Renders nothing when empty, so groups with no documents don't show a card.
 */
function DocumentGroup({
  title,
  description,
  items,
  icon,
  iconTile,
}: {
  title: string;
  description: string;
  items: DealDocumentReviewItem[];
  icon: ReactNode;
  iconTile: string;
}) {
  if (items.length === 0) return null;
  return (
    <BentoCard icon={icon} iconTile={iconTile} title={`${title} (${items.length})`}>
      <p className="text-muted-foreground mb-3 text-[12px]">{description}</p>
      <ul className="space-y-2" role="list">
        {items.map((item) => (
          <DealDocumentReviewRow key={`${item.documentId}:${item.version}`} item={item} />
        ))}
      </ul>
    </BentoCard>
  );
}
