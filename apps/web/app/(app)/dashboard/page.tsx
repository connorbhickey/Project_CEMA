import { CheckCircle, Folder, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import { AgentFleet } from '@/components/dashboard/agent-fleet';
import { LiveActivity } from '@/components/dashboard/live-activity';
import { NeedsYou } from '@/components/dashboard/needs-you';
import { PipelineFlow } from '@/components/dashboard/pipeline-flow';
import { toOrgActivityItem } from '@/lib/agent-activity/org-activity-item';
import {
  type DealExceptions,
  getOrgExceptions,
} from '@/lib/agents/exception-triage/get-org-exceptions';
import { summarizeAgentActivity } from '@/lib/dashboard/agent-activity-summary';
import { type PipelineSummary, summarizePipeline } from '@/lib/dashboard/pipeline-summary';
import { getAgentActionCounts } from '@/lib/queries/agent-action-counts';
import { getDealsByStatus } from '@/lib/queries/deals-by-status';
import { getOrgAgentActivity } from '@/lib/queries/org-agent-activity';
import { routeHref } from '@/lib/routes';

export default async function DashboardPage() {
  const [statusCounts, actionCounts, exceptions, activityPage] = await Promise.all([
    getDealsByStatus(),
    getAgentActionCounts(),
    getOrgExceptions(),
    getOrgAgentActivity(),
  ]);

  const pipeline = summarizePipeline(statusCounts);
  const openExceptionCount = exceptions.reduce((n, d) => n + d.exceptions.length, 0);
  const agentCards = summarizeAgentActivity(actionCounts, openExceptionCount);
  const items = activityPage.items.map(toOrgActivityItem);

  return (
    // Canvas: bg-muted is light cool-gray so white bg-card cards pop
    <div className="bg-muted -m-6 min-h-full p-5">
      {/* Page header */}
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-extrabold tracking-tight">Command Center</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Your CEMA agent fleet across{' '}
            <strong className="text-foreground font-semibold">{pipeline.total}</strong>{' '}
            {pipeline.total === 1 ? 'deal' : 'deals'}.
          </p>
        </div>
        <Link
          href={'/deals'}
          className="border-border bg-card text-foreground hover:border-ring/40 inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-[13px] font-semibold transition-colors"
        >
          <TrendIcon className="h-4 w-4" />
          All deals
        </Link>
      </div>

      {/* 12-col bento grid */}
      <div className="grid grid-cols-12 gap-3">
        {/* ── Hero metrics (4 × col-3) ───────────────────────────── */}
        <HeroMetricCell pipeline={pipeline} exceptions={exceptions} index={0} />
        <HeroMetricCell pipeline={pipeline} exceptions={exceptions} index={1} />
        <HeroMetricCell pipeline={pipeline} exceptions={exceptions} index={2} />
        <HeroMetricCell pipeline={pipeline} exceptions={exceptions} index={3} />

        {/* ── Pipeline flow (col-span-8) ─────────────────────────── */}
        <div className="col-span-8">
          <Card title="Pipeline flow" linkHref="/deals" linkLabel="Open deals">
            <PipelineFlow summary={pipeline} />
          </Card>
        </div>

        {/* ── Needs you (col-span-4) ────────────────────────────── */}
        <div className="col-span-4">
          <Card title="Needs you" linkHref="/exceptions" linkLabel="Queue">
            <NeedsYou exceptions={exceptions} />
          </Card>
        </div>

        {/* ── Agent fleet (col-span-7) ──────────────────────────── */}
        <div className="col-span-7">
          <Card title="Agent fleet" linkHref="/dashboard" linkLabel="Activity">
            <AgentFleet cards={agentCards} />
          </Card>
        </div>

        {/* ── Live activity (col-span-5) ────────────────────────── */}
        <div className="col-span-5" id="recent-activity">
          <Card title="Live activity" linkHref="/dashboard" linkLabel="All">
            <LiveActivity items={items} />
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Card shell ────────────────────────────────────────────────────────────

function Card({
  title,
  linkHref,
  linkLabel,
  children,
}: {
  title: string;
  linkHref: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border-border h-full rounded-2xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-foreground text-[13px] font-bold">{title}</h3>
        <Link
          href={routeHref(linkHref)}
          className="flex items-center gap-1 text-[12px] font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400"
        >
          {linkLabel}
          <ChevronRightIcon className="h-3 w-3" />
        </Link>
      </div>
      {children}
    </div>
  );
}

// ─── Hero metric cells ─────────────────────────────────────────────────────

interface HeroCell {
  tileClass: string;
  iconSlot: React.ReactNode;
  value: number;
  label: string;
  badge?: React.ReactNode;
}

function buildHeroCells(pipeline: PipelineSummary, exceptions: DealExceptions[]): HeroCell[] {
  const activeDeals = pipeline.activeTotal;

  const attorneyStage = pipeline.stages.find((s) => s.status === 'attorney_review');
  const authStage = pipeline.stages.find((s) => s.status === 'authorization');
  const inReview = (attorneyStage?.count ?? 0) + (authStage?.count ?? 0);

  const openExceptions = exceptions.reduce((n, d) => n + d.exceptions.length, 0);
  const highCount = exceptions
    .flatMap((d) => d.exceptions)
    .filter((e) => e.severity === 'high' || e.severity === 'blocking').length;

  const completedStage = pipeline.offRamps.find((s) => s.status === 'completed');
  const completed = completedStage?.count ?? 0;

  return [
    {
      tileClass: 'bg-teal-500/10',
      iconSlot: (
        <Folder className="h-[18px] w-[18px] text-teal-600 dark:text-teal-400" strokeWidth={2} />
      ),
      value: activeDeals,
      label: 'Active deals',
    },
    {
      tileClass: 'bg-blue-500/10',
      iconSlot: <ReviewCheckIcon className="h-[18px] w-[18px] text-blue-600 dark:text-blue-400" />,
      value: inReview,
      label: 'In attorney review',
    },
    {
      tileClass: 'bg-emerald-500/10',
      iconSlot: (
        <CheckCircle
          className="h-[18px] w-[18px] text-emerald-600 dark:text-emerald-400"
          strokeWidth={2}
        />
      ),
      value: completed,
      label: 'Completed deals',
    },
    {
      tileClass: 'bg-amber-500/10',
      iconSlot: (
        <TriangleAlert
          className="h-[18px] w-[18px] text-amber-600 dark:text-amber-400"
          strokeWidth={2}
        />
      ),
      value: openExceptions,
      label: 'Open exceptions',
      badge:
        highCount > 0 ? (
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
            {highCount} high
          </span>
        ) : undefined,
    },
  ];
}

function HeroMetricCell({
  pipeline,
  exceptions,
  index,
}: {
  pipeline: PipelineSummary;
  exceptions: DealExceptions[];
  index: number;
}) {
  const cells = buildHeroCells(pipeline, exceptions);
  const cell = cells[index];
  if (!cell) return null;
  return (
    <div className="col-span-3">
      <div className="bg-card border-border h-full rounded-2xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
        <div className="flex items-start justify-between">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${cell.tileClass}`}>
            {cell.iconSlot}
          </div>
          {cell.badge}
        </div>
        <div className="text-foreground mt-3 text-3xl font-extrabold tabular-nums tracking-tight">
          {cell.value.toLocaleString()}
        </div>
        <div className="text-muted-foreground mt-0.5 text-[12.5px] font-medium">{cell.label}</div>
      </div>
    </div>
  );
}

// ─── Inline SVG icons ──────────────────────────────────────────────────────

function TrendIcon({ className }: { className?: string }) {
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
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}

function ReviewCheckIcon({ className }: { className?: string }) {
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
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

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
