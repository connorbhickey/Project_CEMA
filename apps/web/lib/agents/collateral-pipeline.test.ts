import type { ChainResult } from '@cema/agents-chain-of-title';
import type { IdpResult } from '@cema/agents-collateral-idp';
import type { OutreachResult } from '@cema/agents-servicer-outreach';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the three inner Server Actions the pipeline composes. The pure core
// (hasReChase) is NOT mocked — we want the real branch decision to run.
// ---------------------------------------------------------------------------

vi.mock('./collateral-idp/run-collateral-idp-action', () => ({
  runCollateralIdpFromDeal: vi.fn(),
}));

vi.mock('./chain-of-title/run-chain-of-title-action', () => ({
  runChainOfTitleFromDeal: vi.fn(),
}));

vi.mock('./servicer-outreach/run-outreach-action', () => ({
  runOutreachFromDeal: vi.fn(),
}));

vi.mock('../kg/index-deal-instrument-edges', () => ({
  indexDealInstrumentEdges: vi.fn(),
}));

vi.mock('../kg/index-deal-chain-edges', () => ({
  indexDealChainEdges: vi.fn(),
}));

vi.mock('../kg/index-deal-party-edges', () => ({
  indexDealPartyEdges: vi.fn(),
}));

import { indexDealChainEdges } from '../kg/index-deal-chain-edges';
import { indexDealInstrumentEdges } from '../kg/index-deal-instrument-edges';
import { indexDealPartyEdges } from '../kg/index-deal-party-edges';

import { runChainOfTitleFromDeal } from './chain-of-title/run-chain-of-title-action';
import { runCollateralIdpFromDeal } from './collateral-idp/run-collateral-idp-action';
import { runCollateralPipeline } from './collateral-pipeline';
import { runOutreachFromDeal } from './servicer-outreach/run-outreach-action';

// ---------------------------------------------------------------------------
// Fixtures. IDP results only need an accurate documents.length; the inner
// ClassifiedDoc shape is irrelevant to the pipeline's branching.
// ---------------------------------------------------------------------------

const IDP_EMPTY: IdpResult = { dealId: 'deal-1', documents: [], unreadable: [] };
const IDP_ONE: IdpResult = {
  dealId: 'deal-1',
  documents: [{}],
  unreadable: [],
} as unknown as IdpResult;

const CHAIN_CLEAN: ChainResult = { dealId: 'deal-1', status: 'clean', breaks: [], routes: [] };
const CHAIN_RECHASE: ChainResult = {
  dealId: 'deal-1',
  status: 'broken',
  breaks: [],
  routes: [
    {
      dealId: 'deal-1',
      kind: 're_chase',
      breakKind: 'missing_assignment',
      documentId: null,
      reason: 'gap',
    },
  ],
};
const CHAIN_ATTORNEY: ChainResult = {
  dealId: 'deal-1',
  status: 'ambiguous',
  breaks: [],
  routes: [
    {
      dealId: 'deal-1',
      kind: 'attorney_review',
      breakKind: 'ambiguous_assignment',
      documentId: null,
      reason: 'fork',
    },
  ],
};

const OUTREACH: OutreachResult = {
  dealId: 'deal-1',
  action: { kind: 'send', touchNumber: 1 },
  touchSent: 1,
};

beforeEach(() => {
  vi.mocked(runCollateralIdpFromDeal).mockResolvedValue(IDP_ONE);
  vi.mocked(runChainOfTitleFromDeal).mockResolvedValue(CHAIN_CLEAN);
  vi.mocked(runOutreachFromDeal).mockResolvedValue(OUTREACH);
  vi.mocked(indexDealInstrumentEdges).mockResolvedValue(2);
  vi.mocked(indexDealChainEdges).mockResolvedValue(1);
  vi.mocked(indexDealPartyEdges).mockResolvedValue(3);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runCollateralPipeline', () => {
  it('runs IDP only and skips Chain-of-Title when no documents were classified', async () => {
    vi.mocked(runCollateralIdpFromDeal).mockResolvedValue(IDP_EMPTY);

    const result = await runCollateralPipeline('deal-1');

    expect(result).toEqual({ dealId: 'deal-1', idp: IDP_EMPTY, chain: null, outreach: null });
    expect(runChainOfTitleFromDeal).not.toHaveBeenCalled();
    expect(runOutreachFromDeal).not.toHaveBeenCalled();
    expect(indexDealInstrumentEdges).not.toHaveBeenCalled();
    expect(indexDealChainEdges).not.toHaveBeenCalled();
    // Party edges index independent of collateral docs (a deal has parties
    // regardless), so they ARE indexed even when IDP classified nothing.
    expect(indexDealPartyEdges).toHaveBeenCalledWith('deal-1');
  });

  it('runs Chain-of-Title after IDP but skips Outreach when the chain has no re_chase', async () => {
    vi.mocked(runChainOfTitleFromDeal).mockResolvedValue(CHAIN_ATTORNEY);

    const result = await runCollateralPipeline('deal-1');

    // The deal's instruments are indexed into the KG once IDP classifies them.
    expect(indexDealInstrumentEdges).toHaveBeenCalledWith('deal-1');
    expect(indexDealChainEdges).toHaveBeenCalledWith('deal-1');

    expect(result).toEqual({
      dealId: 'deal-1',
      idp: IDP_ONE,
      chain: CHAIN_ATTORNEY,
      outreach: null,
    });
    expect(runChainOfTitleFromDeal).toHaveBeenCalledWith('deal-1');
    expect(runOutreachFromDeal).not.toHaveBeenCalled();
  });

  it('runs all three stages when Chain-of-Title routes a re_chase break', async () => {
    vi.mocked(runChainOfTitleFromDeal).mockResolvedValue(CHAIN_RECHASE);

    const result = await runCollateralPipeline('deal-1');

    expect(result).toEqual({
      dealId: 'deal-1',
      idp: IDP_ONE,
      chain: CHAIN_RECHASE,
      outreach: OUTREACH,
    });
    expect(runOutreachFromDeal).toHaveBeenCalledWith('deal-1');
  });

  it('propagates an IDP failure without running the downstream stages', async () => {
    vi.mocked(runCollateralIdpFromDeal).mockRejectedValue(new Error('idp boom'));

    await expect(runCollateralPipeline('deal-1')).rejects.toThrow('idp boom');
    expect(runChainOfTitleFromDeal).not.toHaveBeenCalled();
    expect(runOutreachFromDeal).not.toHaveBeenCalled();
  });
});
