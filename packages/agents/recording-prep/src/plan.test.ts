import { GATE_REQUIRED_KINDS } from '@cema/collateral';
import { describe, expect, it } from 'vitest';

import { computeFees, planRecording } from './plan';
import type { DealRecordingInput } from './types';

const NYC_REFI: DealRecordingInput = {
  dealId: 'd1',
  cemaType: 'refi_cema',
  county: 'Kings',
  acrisBbl: '3-00100-0001',
};
const UPSTATE_REFI: DealRecordingInput = {
  dealId: 'd1',
  cemaType: 'refi_cema',
  county: 'Nassau',
  acrisBbl: null,
};
const NYC_PURCHASE: DealRecordingInput = {
  dealId: 'd1',
  cemaType: 'purchase_cema',
  county: 'Queens',
  acrisBbl: '4-00100-0001',
};
const UPSTATE_PURCHASE: DealRecordingInput = {
  dealId: 'd1',
  cemaType: 'purchase_cema',
  county: 'Erie',
  acrisBbl: null,
};

const kinds = (i: DealRecordingInput) =>
  planRecording(i)
    .coverSheets.map((s) => s.kind)
    .sort();

describe('planRecording', () => {
  it('NYC refi -> just acris_cover_pages', () => {
    expect(kinds(NYC_REFI)).toEqual(['acris_cover_pages']);
    expect(planRecording(NYC_REFI).venue).toBe('acris');
  });

  it('upstate refi -> just county_cover_sheet', () => {
    expect(kinds(UPSTATE_REFI)).toEqual(['county_cover_sheet']);
    expect(planRecording(UPSTATE_REFI).venue).toBe('county');
  });

  it('NYC purchase -> acris_cover_pages + nyc_rpt + tp_584', () => {
    expect(kinds(NYC_PURCHASE)).toEqual(['acris_cover_pages', 'nyc_rpt', 'tp_584'].sort());
  });

  it('upstate purchase -> county_cover_sheet + tp_584 (no nyc_rpt)', () => {
    expect(kinds(UPSTATE_PURCHASE)).toEqual(['county_cover_sheet', 'tp_584'].sort());
  });

  it('only county_cover_sheet is attorney-gated; the others are not', () => {
    const gate = new Set<string>(GATE_REQUIRED_KINDS);
    for (const s of planRecording(NYC_PURCHASE).coverSheets) {
      expect(s.attorneyReviewRequired).toBe(gate.has(s.kind));
    }
    const county = planRecording(UPSTATE_REFI).coverSheets.find(
      (s) => s.kind === 'county_cover_sheet',
    );
    expect(county?.attorneyReviewRequired).toBe(true);
    const acris = planRecording(NYC_REFI).coverSheets.find((s) => s.kind === 'acris_cover_pages');
    expect(acris?.attorneyReviewRequired).toBe(false);
  });

  it('computes fees with the flat county add-on (placeholder schedule)', () => {
    const f = computeFees('Nassau', 40);
    expect(f.flatCountyFee).toBe(355);
    expect(f.total).toBe(40 + 5 * 40 + 355); // base + per-page*pages + flat
    expect(computeFees('Albany', 40).flatCountyFee).toBe(0);
  });

  it('uses the placeholder page-count default when none is supplied', () => {
    expect(planRecording(NYC_REFI).fees.pageCount).toBe(40);
    expect(planRecording({ ...NYC_REFI, pageCount: 50 }).fees.pageCount).toBe(50);
  });

  it('cover-sheet fields are PII-free (whitelisted keys only, no SSN)', () => {
    for (const s of planRecording(NYC_PURCHASE).coverSheets) {
      expect(Object.keys(s.fields).sort()).toEqual(['county', 'dealId', 'total', 'venue']);
      expect(JSON.stringify(s.fields)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    }
  });
});
