import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { communications } from './communications';
import { recordings } from './recordings';

describe('communications schema', () => {
  it('communications is the queryable layer with vendor + party + media metadata', () => {
    const cols = Object.keys(communications);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'organizationId',
        'dealId',
        'kind',
        'direction',
        'medium',
        'provider',
        'vendorCallId',
        'vendorEventId',
        'fromPartyId',
        'toPartyIds',
        'fromE164',
        'toE164',
        'startedAt',
        'endedAt',
        'durationSeconds',
        'sourceThreadId',
        'status',
        'aiSummary',
        'aiActionItems',
        'aiSentiment',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('communications has vendor_event_id unique constraint for webhook idempotency', () => {
    const config = getTableConfig(communications);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain('communications_vendor_event_id_uidx');
  });

  it('communications has composite unique constraint on (provider, vendor_call_id) for dedupe', () => {
    const config = getTableConfig(communications);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain('communications_provider_vendor_call_id_uidx');
  });

  it('communications has org_scoped pipeline index for timeline queries', () => {
    const config = getTableConfig(communications);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain('communications_org_started_at_idx');
    expect(indexNames).toContain('communications_deal_started_at_idx');
  });

  it('communications has CHECK that calls require a telephony provider', () => {
    const config = getTableConfig(communications);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('communications_call_requires_provider');
  });

  it('communications has CHECK that duration_seconds is non-negative', () => {
    const config = getTableConfig(communications);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('communications_duration_nonneg');
  });
});

describe('recordings schema', () => {
  it('recordings stores blob URLs, transcript metadata, and retention controls', () => {
    const cols = Object.keys(recordings);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'communicationId',
        'recordingBlobUrl',
        'recordingBlobPathname',
        'recordingBytes',
        'recordingDurationSeconds',
        'mimeType',
        'transcriptBlobUrl',
        'transcriptBlobPathname',
        'transcriptWordsCount',
        'transcriptLanguage',
        'transcriptProvider',
        'consentDisclosureEmittedAt',
        'legalHold',
        'retentionUntil',
        'deletedAt',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('recordings has CHECK that retention_until is in the future of created_at', () => {
    const config = getTableConfig(recordings);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('recordings_retention_future');
  });

  it('recordings has CHECK that legal_hold blocks soft-delete (hard rule #6)', () => {
    const config = getTableConfig(recordings);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('recordings_no_delete_under_legal_hold');
  });

  it('recordings has UNIQUE on communication_id (1:1 invariant + FK index)', () => {
    const config = getTableConfig(recordings);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain('recordings_communication_id_uidx');
  });

  it('recordings has retention_until index for lifecycle cron (Phase 1)', () => {
    const config = getTableConfig(recordings);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain('recordings_retention_until_idx');
  });

  it('recordings has non-negative CHECKs on bytes, duration, and word count', () => {
    const config = getTableConfig(recordings);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('recordings_recording_bytes_nonneg');
    expect(checkNames).toContain('recordings_recording_duration_nonneg');
    expect(checkNames).toContain('recordings_transcript_words_nonneg');
  });
});
