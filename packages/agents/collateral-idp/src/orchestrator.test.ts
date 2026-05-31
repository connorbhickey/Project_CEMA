import { describe, expect, it, vi } from 'vitest';

import { runCollateralIdp } from './orchestrator';
import type { IdpAdapter, IdpAuditEvent, IdpContext, ClassifiedDoc, RawExtraction } from './types';

function makeDeps(overrides: {
  context: IdpContext;
  extractions: Readonly<Record<string, readonly RawExtraction[]>>;
}) {
  const events: string[] = [];
  const persisted: ClassifiedDoc[][] = [];
  const idp: IdpAdapter = {
    extractDocuments: (blobUrl) =>
      Promise.resolve(
        overrides.extractions[blobUrl] ?? [{ text: null, fields: {}, confidence: 0 }],
      ),
  };
  const deps = {
    idp,
    loadContext: vi.fn(() => Promise.resolve(overrides.context)),
    persistDocuments: vi.fn((_dealId: string, docs: readonly ClassifiedDoc[]) => {
      persisted.push([...docs]);
      events.push('idp.documents_classified');
      return Promise.resolve();
    }),
    emitAudit: vi.fn((e: IdpAuditEvent) => {
      events.push(e.action);
      return Promise.resolve();
    }),
  };
  return { deps, events, persisted };
}

describe('runCollateralIdp', () => {
  it('classifies + persists readable docs and emits the split audit in order', async () => {
    const { deps, events, persisted } = makeDeps({
      context: { dealId: 'deal-1', documents: [{ documentId: 'doc-1', blobUrl: 'blob://aom' }] },
      extractions: {
        'blob://aom': [
          { text: null, fields: { documentType: 'Assignment of Mortgage' }, confidence: 0.9 },
        ],
      },
    });

    const result = await runCollateralIdp('deal-1', deps);

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.kind).toBe('aom');
    expect(result.documents[0]?.attorneyReviewRequired).toBe(true);
    expect(result.unreadable).toHaveLength(0);
    expect(persisted[0]).toHaveLength(1);
    expect(events).toEqual(['idp.evaluated', 'idp.documents_classified']);
  });

  it('routes a low-confidence segment to unreadable and never persists it', async () => {
    const { deps, events, persisted } = makeDeps({
      context: { dealId: 'deal-1', documents: [{ documentId: 'doc-1', blobUrl: 'blob://blurry' }] },
      extractions: {
        'blob://blurry': [{ text: 'Mortgage', fields: {}, confidence: 0.2 }],
      },
    });

    const result = await runCollateralIdp('deal-1', deps);

    expect(result.documents).toHaveLength(0);
    expect(result.unreadable).toEqual([{ documentId: 'doc-1', blobUrl: 'blob://blurry' }]);
    expect(persisted).toHaveLength(0);
    expect(events).toEqual(['idp.evaluated']);
  });

  it('routes a null-text segment to unreadable', async () => {
    const { deps, persisted } = makeDeps({
      context: {
        dealId: 'deal-1',
        documents: [{ documentId: 'doc-1', blobUrl: 'blob://missing' }],
      },
      extractions: { 'blob://missing': [{ text: null, fields: {}, confidence: 0 }] },
    });

    const result = await runCollateralIdp('deal-1', deps);

    expect(result.unreadable).toHaveLength(1);
    expect(persisted).toHaveLength(0);
  });

  it('sets attorneyReviewRequired=false for a non-gated kind', async () => {
    const { deps } = makeDeps({
      context: { dealId: 'deal-1', documents: [{ documentId: 'doc-1', blobUrl: 'blob://note' }] },
      extractions: {
        'blob://note': [
          { text: null, fields: { documentType: 'Promissory Note' }, confidence: 0.9 },
        ],
      },
    });

    const result = await runCollateralIdp('deal-1', deps);

    expect(result.documents[0]?.kind).toBe('note');
    expect(result.documents[0]?.attorneyReviewRequired).toBe(false);
  });

  it('emits idp.evaluated with accurate counts', async () => {
    const { deps } = makeDeps({
      context: {
        dealId: 'deal-1',
        documents: [
          { documentId: 'doc-1', blobUrl: 'blob://aom' },
          { documentId: 'doc-2', blobUrl: 'blob://blurry' },
        ],
      },
      extractions: {
        'blob://aom': [
          { text: null, fields: { documentType: 'Assignment of Mortgage' }, confidence: 0.9 },
        ],
        'blob://blurry': [{ text: 'x', fields: {}, confidence: 0.1 }],
      },
    });

    await runCollateralIdp('deal-1', deps);

    expect(deps.emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'idp.evaluated',
        documentCount: 1,
        unreadableCount: 1,
        gateRequiredCount: 1,
      }),
    );
  });
});
