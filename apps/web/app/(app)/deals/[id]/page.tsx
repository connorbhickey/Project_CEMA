/**
 * Deal hub overview — Command Center design language.
 * Server-rendered RSC. Canvas: bg-muted cool-gray; cards: bg-card rounded-2xl
 * hairline border + subtle shadow. On-brand: teal / blue / cyan / sky / amber /
 * slate / emerald. No violet / indigo / purple. No raw hex.
 */

import {
  BadgeDollarSign,
  BookOpen,
  Building2,
  FileStack,
  GitFork,
  Landmark,
  LayoutDashboard,
  TriangleAlert,
  Users,
  Zap,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DealStatusBadge } from '@/components/deal-status-badge';
import { getDeal } from '@/lib/actions/get-deal';
import { parseDealRecording } from '@/lib/deals/deal-recording';
import { cemaTypeLabel, loanProgramLabel, propertyTypeLabel } from '@/lib/deals/enum-labels';
import { partyRoleLabel } from '@/lib/deals/party-role';
import { parseSavingsNarrative } from '@/lib/deals/savings-narrative';
import { getDealParties } from '@/lib/queries/deal-parties';

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

  const { deal, property, newLoan, existingLoans } = data;
  const recording = parseDealRecording(deal.metadata);
  const savingsNarrative = parseSavingsNarrative(deal.metadata);
  const parties = await getDealParties(id);

  const shortId = deal.id.slice(0, 8);
  const streetLine = property?.streetAddress
    ? property.unit
      ? `${property.streetAddress} ${property.unit}`
      : property.streetAddress
    : null;
  const cityLine = property?.city ?? null;

  // Format money amounts without raw string concatenation
  const fmtUsd = (raw: unknown): string => {
    const n = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN;
    return isNaN(n) ? '—' : `$${n.toLocaleString('en-US')}`;
  };

  // Extract savings amount from the narrative text (look for a $N,NNN pattern)
  const savingsAmount: string | null = (() => {
    if (!savingsNarrative) return null;
    const m = savingsNarrative.text.match(/\$([\d,]+)/);
    return m ? `$${m[1]}` : null;
  })();

  return (
    // Cool-gray canvas — same -m-6 p-5 trick as the dashboard
    <div className="bg-muted -m-6 min-h-full p-5">
      {/* ── Sticky deal header ─────────────────────────────────────────── */}
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

        {/* ── Sub-tab nav ─────────────────────────────────────────────── */}
        <nav className="border-border mt-4 flex gap-0 border-b">
          {[
            {
              label: 'Overview',
              href: `/deals/${id}` as Route,
              icon: LayoutDashboard,
              active: true,
            },
            { label: 'Parties', href: `/deals/${id}/parties` as Route, icon: Users, active: false },
            {
              label: 'Loans',
              href: `/deals/${id}/loans` as Route,
              icon: BadgeDollarSign,
              active: false,
            },
            {
              label: 'Documents',
              href: `/deals/${id}/documents` as Route,
              icon: FileStack,
              active: false,
            },
            {
              label: 'Activity',
              href: `/deals/${id}/agent-activity` as Route,
              icon: Zap,
              active: false,
            },
            { label: 'Graph', href: `/deals/${id}/graph` as Route, icon: GitFork, active: false },
            {
              label: 'Exceptions',
              href: `/deals/${id}/exceptions` as Route,
              icon: TriangleAlert,
              active: false,
            },
          ].map(({ label, href, icon: Icon, active }) => (
            <Link
              key={label}
              href={href}
              className={`flex items-center gap-1.5 border-b-2 px-3.5 pb-2.5 pt-1 text-[12.5px] font-semibold transition-colors ${
                active
                  ? 'border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-400'
                  : 'text-muted-foreground hover:text-foreground hover:border-border border-transparent'
              }`}
            >
              <Icon
                className={`h-3.5 w-3.5 ${active ? 'text-teal-600 dark:text-teal-400' : ''}`}
                strokeWidth={2}
              />
              {label}
            </Link>
          ))}
        </nav>
      </div>

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
            <EmptyState>No property on file.</EmptyState>
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
            <EmptyState>No new loan on file.</EmptyState>
          )}
        </BentoCard>

        {/* ── Existing loans card ────────────────────────────────────── */}
        <BentoCard
          icon={<BookOpen className="h-4 w-4 text-cyan-600 dark:text-cyan-400" strokeWidth={2} />}
          iconTile="bg-cyan-500/10"
          title={`Existing loans${existingLoans.length > 0 ? ` (${existingLoans.length})` : ''}`}
          linkHref={`/deals/${id}/loans` as Route}
          linkLabel="Edit"
        >
          {existingLoans.length === 0 ? (
            <EmptyState>
              No existing loans yet.{' '}
              <Link
                href={`/deals/${id}/loans` as Route}
                className="text-teal-600 hover:text-teal-700 dark:text-teal-400"
              >
                Add them →
              </Link>
            </EmptyState>
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
          linkHref={`/deals/${id}/parties` as Route}
          linkLabel="Edit"
        >
          {parties.length === 0 ? (
            <EmptyState>
              No parties yet.{' '}
              <Link
                href={`/deals/${id}/parties` as Route}
                className="text-teal-600 hover:text-teal-700 dark:text-teal-400"
              >
                Add them →
              </Link>
            </EmptyState>
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

// ─── Card shell ───────────────────────────────────────────────────────────────

function BentoCard({
  icon,
  iconTile,
  title,
  linkHref,
  linkLabel,
  children,
}: {
  icon: React.ReactNode;
  iconTile: string;
  title: string;
  linkHref?: Route;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border-border rounded-2xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconTile}`}
          >
            {icon}
          </div>
          <h3 className="text-foreground text-[13px] font-bold">{title}</h3>
        </div>
        {linkHref && linkLabel ? (
          <Link
            href={linkHref}
            className="flex items-center gap-1 text-[12px] font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400"
          >
            {linkLabel}
            <ChevronRightIcon className="h-3 w-3" />
          </Link>
        ) : null}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

// ─── Data row ─────────────────────────────────────────────────────────────────

function DataRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground shrink-0 text-[12.5px]">{label}</dt>
      <dd
        className={`text-foreground text-right text-[13px] font-medium ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-[12.5px]">{children}</p>;
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
