/**
 * Shared deal-hub chrome — the sticky header (CEMA type · address · status badge ·
 * §255 savings · recorded chip) and the 7-tab nav, rendered at the top of EVERY
 * deal sub-view so the deal context + navigation are constant across Overview,
 * Parties, Loans, Documents, Activity, Graph, and Exceptions.
 *
 * A server component: it self-fetches the (React-cached) deal and takes the active
 * tab as an explicit prop, so no `'use client'` / `usePathname` is needed — the
 * page already knows which tab it is. On-brand teal accent; no violet/indigo/purple.
 */

import {
  BadgeDollarSign,
  FileStack,
  GitFork,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  TriangleAlert,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DealStatusBadge } from '@/components/deal-status-badge';
import { getDeal } from '@/lib/actions/get-deal';
import { parseDealRecording } from '@/lib/deals/deal-recording';
import { cemaTypeLabel } from '@/lib/deals/enum-labels';
import { parseSavingsNarrative } from '@/lib/deals/savings-narrative';
import { routeHref } from '@/lib/routes';

export type DealHubTab =
  | 'overview'
  | 'parties'
  | 'loans'
  | 'documents'
  | 'activity'
  | 'graph'
  | 'exceptions';

const TABS: { key: DealHubTab; label: string; segment: string; icon: LucideIcon }[] = [
  { key: 'overview', label: 'Overview', segment: '', icon: LayoutDashboard },
  { key: 'parties', label: 'Parties', segment: '/parties', icon: Users },
  { key: 'loans', label: 'Loans', segment: '/loans', icon: BadgeDollarSign },
  { key: 'documents', label: 'Documents', segment: '/documents', icon: FileStack },
  { key: 'activity', label: 'Timeline', segment: '/timeline', icon: MessagesSquare },
  { key: 'graph', label: 'Graph', segment: '/graph', icon: GitFork },
  { key: 'exceptions', label: 'Exceptions', segment: '/exceptions', icon: TriangleAlert },
];

export async function DealHubHeader({
  dealId,
  active,
}: {
  dealId: string;
  /** The active tab, or `null` for deal sub-routes that aren't one of the 7 tabs
   *  (Communications / Files / Activity) — renders the header + nav with nothing
   *  highlighted so the user can still navigate back to a tab. */
  active: DealHubTab | null;
}) {
  const data = await getDeal(dealId);
  if (!data) notFound();

  const { deal, property } = data;
  const recording = parseDealRecording(deal.metadata);
  const savingsNarrative = parseSavingsNarrative(deal.metadata);

  const shortId = deal.id.slice(0, 8);
  const streetLine = property?.streetAddress
    ? property.unit
      ? `${property.streetAddress} ${property.unit}`
      : property.streetAddress
    : null;
  const cityLine = property?.city ?? null;

  const savingsAmount: string | null = (() => {
    if (!savingsNarrative) return null;
    const m = savingsNarrative.text.match(/\$([\d,]+)/);
    return m ? `$${m[1]}` : null;
  })();

  return (
    <div className="bg-card border-border sticky top-0 z-10 mb-5 rounded-2xl border px-5 py-4 shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Left: title + id + county */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-foreground text-xl font-extrabold tracking-tight">
              {cemaTypeLabel(deal.cemaType)}
              {streetLine ? (
                <>
                  {' '}
                  <span className="text-muted-foreground font-semibold">·</span>{' '}
                  <span>{streetLine}</span>
                  {cityLine ? <span className="text-muted-foreground">, {cityLine}</span> : null}
                </>
              ) : null}
            </h1>
            <DealStatusBadge status={deal.status} size="lg" />
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
            <span className="font-mono">{shortId}…</span>
            {property?.county ? (
              <>
                <span className="opacity-40">·</span>
                <span>{property.county} County</span>
              </>
            ) : null}
          </div>
        </div>

        {/* Right: savings amount + recorded chip */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {savingsAmount ? (
            <div className="flex flex-col items-end">
              <span className="text-xl font-extrabold tabular-nums leading-none text-emerald-600 dark:text-emerald-400">
                {savingsAmount}
              </span>
              <span className="text-muted-foreground mt-0.5 text-[11px] font-medium">
                Est. §255 savings
              </span>
            </div>
          ) : null}
          {recording ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              Recorded
              {recording.crfn ? (
                <> · CRFN {recording.crfn}</>
              ) : recording.reelPage ? (
                <> · Reel/Page {recording.reelPage}</>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>

      {/* Sub-tab nav */}
      <nav className="border-border mt-4 flex gap-0 overflow-x-auto border-b">
        {TABS.map(({ key, label, segment, icon: Icon }) => {
          const isActive = key === active;
          return (
            <Link
              key={key}
              href={routeHref(`/deals/${dealId}${segment}`)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 pb-2.5 pt-1 text-[12.5px] font-semibold transition-colors ${
                isActive
                  ? 'border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-400'
                  : 'text-muted-foreground hover:text-foreground hover:border-border border-transparent'
              }`}
            >
              <Icon
                className={`h-3.5 w-3.5 ${isActive ? 'text-teal-600 dark:text-teal-400' : ''}`}
                strokeWidth={2}
              />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
