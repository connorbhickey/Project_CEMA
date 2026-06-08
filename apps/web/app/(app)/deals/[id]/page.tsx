/**
 * Deal hub overview — Command Center design language.
 * Server-rendered RSC. Canvas: bg-muted cool-gray; cards: shared BentoCard
 * (bg-card rounded-2xl hairline border + subtle shadow). The sticky header + tab
 * nav come from the shared <DealHubHeader>. On-brand: teal / blue / cyan / sky /
 * amber / slate / emerald. No violet / indigo / purple. No raw hex.
 */

import { BadgeDollarSign, BookOpen, Building2, Landmark, Users } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BentoCard, CardEmptyState, DataRow } from '@/components/deal-hub/bento-card';
import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
import { getDeal } from '@/lib/actions/get-deal';
import { loanProgramLabel, propertyTypeLabel } from '@/lib/deals/enum-labels';
import { partyRoleLabel } from '@/lib/deals/party-role';
import { parseSavingsNarrative } from '@/lib/deals/savings-narrative';
import { getDealParties } from '@/lib/queries/deal-parties';
import { routeHref } from '@/lib/routes';

// ─── Party role pill colours ──────────────────────────────────────────────────

const ROLE_PILL: Record<string, string> = {
  borrower: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  co_borrower: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  seller: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  seller_attorney: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  closing_attorney: 'bg-blue-600/10 text-blue-700 dark:text-blue-400',
  loan_officer: 'bg-teal-600/10 text-teal-700 dark:text-teal-400',
  processor: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  title_agent: 'bg-slate-400/10 text-slate-500 dark:text-slate-400',
  doc_custodian: 'bg-slate-400/10 text-slate-500 dark:text-slate-400',
};
const ROLE_PILL_FALLBACK = 'bg-slate-400/10 text-slate-500 dark:text-slate-400';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDeal(id);
  if (!data) notFound();

  const { property, newLoan, existingLoans } = data;
  const savingsNarrative = parseSavingsNarrative(data.deal.metadata);
  const parties = await getDealParties(id);

  const streetLine = property?.streetAddress
    ? property.unit
      ? `${property.streetAddress} ${property.unit}`
      : property.streetAddress
    : null;

  // Format money amounts without raw string concatenation
  const fmtUsd = (raw: unknown): string => {
    const n = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN;
    return isNaN(n) ? '—' : `$${n.toLocaleString('en-US')}`;
  };

  return (
    // Cool-gray canvas — same -m-6 p-5 trick as the dashboard
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={id} active="overview" />

      {/* ── Bento grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* ── Property card ─────────────────────────────────────────── */}
        <BentoCard
          icon={<Building2 className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />}
          iconTile="bg-teal-500/10"
          title="Property"
        >
          {property ? (
            <dl className="space-y-2">
              {streetLine ? <DataRow label="Address" value={streetLine} /> : null}
              {property.city || property.county ? (
                <DataRow
                  label="City / County"
                  value={[property.city, property.county ? `${property.county} County` : null]
                    .filter(Boolean)
                    .join(', ')}
                />
              ) : null}
              {property.zipCode ? <DataRow label="ZIP" value={property.zipCode} /> : null}
              <DataRow label="Type" value={propertyTypeLabel(property.propertyType)} />
            </dl>
          ) : (
            <CardEmptyState>No property on file.</CardEmptyState>
          )}
        </BentoCard>

        {/* ── New loan card ──────────────────────────────────────────── */}
        <BentoCard
          icon={<Landmark className="h-4 w-4 text-blue-600 dark:text-blue-400" strokeWidth={2} />}
          iconTile="bg-blue-500/10"
          title="New loan"
        >
          {newLoan ? (
            <dl className="space-y-2">
              <DataRow label="Principal" value={fmtUsd(newLoan.principal)} mono />
              <DataRow label="Program" value={loanProgramLabel(newLoan.program)} />
            </dl>
          ) : (
            <CardEmptyState>No new loan on file.</CardEmptyState>
          )}
        </BentoCard>

        {/* ── Existing loans card ────────────────────────────────────── */}
        <BentoCard
          icon={<BookOpen className="h-4 w-4 text-cyan-600 dark:text-cyan-400" strokeWidth={2} />}
          iconTile="bg-cyan-500/10"
          title={`Existing loans${existingLoans.length > 0 ? ` (${existingLoans.length})` : ''}`}
          linkHref={routeHref(`/deals/${id}/loans`)}
          linkLabel="Edit"
        >
          {existingLoans.length === 0 ? (
            <CardEmptyState>
              No existing loans yet.{' '}
              <Link
                href={routeHref(`/deals/${id}/loans`)}
                className="text-teal-600 hover:text-teal-700 dark:text-teal-400"
              >
                Add them →
              </Link>
            </CardEmptyState>
          ) : (
            <ul className="divide-border divide-y">
              {existingLoans.map((loan) => (
                <li
                  key={loan.id}
                  className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                >
                  <span className="text-foreground text-[13px] font-semibold tabular-nums">
                    {fmtUsd(loan.upb)}
                  </span>
                  <span className="text-muted-foreground text-[12px]">
                    Chain pos. {loan.chainPosition}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </BentoCard>

        {/* ── Parties card ───────────────────────────────────────────── */}
        <BentoCard
          icon={<Users className="h-4 w-4 text-sky-600 dark:text-sky-400" strokeWidth={2} />}
          iconTile="bg-sky-500/10"
          title={`Parties${parties.length > 0 ? ` (${parties.length})` : ''}`}
          linkHref={routeHref(`/deals/${id}/parties`)}
          linkLabel="Edit"
        >
          {parties.length === 0 ? (
            <CardEmptyState>
              No parties yet.{' '}
              <Link
                href={routeHref(`/deals/${id}/parties`)}
                className="text-teal-600 hover:text-teal-700 dark:text-teal-400"
              >
                Add them →
              </Link>
            </CardEmptyState>
          ) : (
            <ul className="divide-border divide-y">
              {parties.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-2 first:pt-0 last:pb-0"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ROLE_PILL[p.role] ?? ROLE_PILL_FALLBACK}`}
                  >
                    {partyRoleLabel(p.role)}
                  </span>
                  <span className="text-foreground text-[13px] font-medium">
                    {p.fullName ?? '—'}
                  </span>
                  {p.email ? (
                    <span className="text-muted-foreground text-[11.5px]">{p.email}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </BentoCard>

        {/* ── Savings narrative card (full width, conditional) ─────── */}
        {savingsNarrative ? (
          <div className="md:col-span-2">
            <BentoCard
              icon={
                <BadgeDollarSign
                  className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                  strokeWidth={2}
                />
              }
              iconTile="bg-emerald-500/10"
              title="Estimated §255 savings"
            >
              <p className="text-foreground/90 whitespace-pre-line text-[13px] leading-relaxed">
                {savingsNarrative.text}
              </p>
              <p className="text-muted-foreground mt-3 border-t border-dashed pt-3 text-[11px]">
                AI-generated estimate
                {savingsNarrative.generatedAt ? ` · ${savingsNarrative.generatedAt}` : ''} —
                internal only; not borrower-facing without attorney review.
              </p>
            </BentoCard>
          </div>
        ) : null}
      </div>
    </div>
  );
}
