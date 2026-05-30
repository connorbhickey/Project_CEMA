import { describe, expect, it } from 'vitest';

import { renderTemplateEmail, type DraftEmailInput } from '../src/draft';

import { OUTREACH_FIXTURES } from './fixtures';
import {
  containsDealReference,
  noLegalAdvice,
  noPiiLeak,
  professionalB2bTone,
  requestsCollateralFile,
  type OutreachEmail,
} from './scorers';

const input: DraftEmailInput = {
  servicerName: 'Acme Loan Servicing',
  touchNumber: 1,
  dealReference: 'deal-abc-123',
};

describe('noLegalAdvice', () => {
  it('passes an operational request', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Please send the collateral file.' };
    expect(noLegalAdvice({ input, output }).score).toBe(1);
  });
  it('fails text that gives legal advice', () => {
    const output: OutreachEmail = {
      subject: 'x',
      body: 'As your attorney, we advise you to sign.',
    };
    expect(noLegalAdvice({ input, output }).score).toBe(0);
  });
});

describe('containsDealReference', () => {
  it('passes when the body carries the reference', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Re: deal-abc-123 -- please reply.' };
    expect(containsDealReference({ input, output }).score).toBe(1);
  });
  it('fails when the reference is missing', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Please reply.' };
    expect(containsDealReference({ input, output }).score).toBe(0);
  });
});

describe('noPiiLeak', () => {
  it('passes a clean body', () => {
    const output: OutreachEmail = {
      subject: 'x',
      body: 'Re: deal-abc-123 -- collateral file please.',
    };
    expect(noPiiLeak({ input, output }).score).toBe(1);
  });
  it('fails an SSN', () => {
    const output: OutreachEmail = { subject: 'x', body: 'SSN 123-45-6789 attached.' };
    expect(noPiiLeak({ input, output }).score).toBe(0);
  });
  it('fails a labeled loan number', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Loan number 100482233 enclosed.' };
    expect(noPiiLeak({ input, output }).score).toBe(0);
  });
  it('does NOT flag a UUID deal reference (opaque id, not PII)', () => {
    const uuidInput: DraftEmailInput = {
      servicerName: null,
      touchNumber: 1,
      dealReference: '550e8400-e29b-41d4-a716-446655440000',
    };
    const output: OutreachEmail = {
      subject: 'x',
      body: 'Deal reference: 550e8400-e29b-41d4-a716-446655440000. Please send the file.',
    };
    expect(noPiiLeak({ input: uuidInput, output }).score).toBe(1);
  });
});

describe('professionalB2bTone', () => {
  it('passes a greeting + sign-off', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Dear team,\nPlease help.\nThank you.' };
    expect(professionalB2bTone({ input, output }).score).toBe(1);
  });
  it('fails shouting with no structure', () => {
    const output: OutreachEmail = { subject: 'x', body: 'SENDMETHEFILERIGHTNOWIMMEDIATELY' };
    expect(professionalB2bTone({ input, output }).score).toBe(0);
  });
});

describe('requestsCollateralFile', () => {
  it('passes when it asks for the collateral file', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Please send the collateral file.' };
    expect(requestsCollateralFile({ input, output }).score).toBe(1);
  });
  it('fails an off-topic body', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Happy holidays from our team!' };
    expect(requestsCollateralFile({ input, output }).score).toBe(0);
  });
});

describe('template floor passes every compliance scorer over all fixtures', () => {
  it.each(OUTREACH_FIXTURES)('servicer=$servicerName touch=$touchNumber', (fixture) => {
    const output = renderTemplateEmail(fixture);
    for (const scorer of [
      noLegalAdvice,
      containsDealReference,
      noPiiLeak,
      professionalB2bTone,
      requestsCollateralFile,
    ]) {
      expect(scorer({ input: fixture, output }).score).toBe(1);
    }
  });
});
