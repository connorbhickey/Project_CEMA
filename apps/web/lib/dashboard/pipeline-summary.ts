/** A row from getDealsByStatus: one deal_status + how many deals are in it. */
export interface DealStatusCount {
  readonly status: string;
  readonly count: number;
}

export interface PipelineStage {
  readonly status: string;
  readonly label: string;
  readonly count: number;
}

export interface PipelineSummary {
  readonly stages: PipelineStage[]; // active lifecycle, in order, zeros filled
  readonly offRamps: PipelineStage[]; // completed / exception / cancelled
  readonly activeTotal: number; // sum of active stages (deals in flight)
  readonly total: number; // all deals incl. off-ramps + any unknown status
}

// Active lifecycle order (the funnel). Off-ramps handled separately.
const ACTIVE_STATUSES = [
  'intake',
  'eligibility',
  'authorization',
  'collateral_chase',
  'title_work',
  'doc_prep',
  'attorney_review',
  'closing',
  'recording',
] as const;
const OFF_RAMP_STATUSES = ['completed', 'exception', 'cancelled'] as const;

const STATUS_LABELS: Record<string, string> = {
  intake: 'Intake',
  eligibility: 'Eligibility',
  authorization: 'Authorization',
  collateral_chase: 'Collateral Chase',
  title_work: 'Title Work',
  doc_prep: 'Doc Prep',
  attorney_review: 'Attorney Review',
  closing: 'Closing',
  recording: 'Recording',
  completed: 'Completed',
  exception: 'Exception',
  cancelled: 'Cancelled',
};

function labelFor(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Pure: turn deals-by-status counts into an ordered pipeline funnel. Active
 * lifecycle stages come first (canonical order, zero-filled for empty statuses),
 * then the off-ramps. Any unknown status is excluded from the funnel but still
 * counted in `total` so the headline never under-reports.
 */
export function summarizePipeline(counts: readonly DealStatusCount[]): PipelineSummary {
  const byStatus = new Map<string, number>();
  for (const { status, count } of counts) {
    byStatus.set(status, (byStatus.get(status) ?? 0) + count);
  }

  const stages = ACTIVE_STATUSES.map((status) => ({
    status,
    label: labelFor(status),
    count: byStatus.get(status) ?? 0,
  }));
  const offRamps = OFF_RAMP_STATUSES.map((status) => ({
    status,
    label: labelFor(status),
    count: byStatus.get(status) ?? 0,
  }));

  const activeTotal = stages.reduce((n, s) => n + s.count, 0);
  const total = [...byStatus.values()].reduce((n, c) => n + c, 0);

  return { stages, offRamps, activeTotal, total };
}
