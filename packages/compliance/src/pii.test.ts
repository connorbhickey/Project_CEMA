import { describe, expect, it } from 'vitest';

import { maskSsn, redactPii } from './pii';

describe('PII redaction', () => {
  it('masks SSN to last-4 only (dashed format)', () => {
    expect(maskSsn('123-45-6789')).toBe('***-**-6789');
  });

  it('masks SSN to last-4 only (no-dash format)', () => {
    expect(maskSsn('123456789')).toBe('*****6789');
  });

  it('redactPii replaces SSN strings in arbitrary text', () => {
    const input = 'Borrower SSN: 123-45-6789, email: test@example.com';
    const out = redactPii(input);
    expect(out).not.toContain('123-45-6789');
    expect(out).toContain('***-**-6789');
  });

  it('redactPii is a no-op for null/undefined', () => {
    expect(redactPii(null as unknown as string)).toBeNull();
    expect(redactPii(undefined as unknown as string)).toBeUndefined();
  });

  it('redactPii recurses into objects without mutating input', () => {
    const input = { ssn: '123-45-6789', name: 'Alice', age: 33 };
    const out = redactPii(input);
    expect(input.ssn).toBe('123-45-6789'); // original unchanged
    expect(out.ssn).toBe('***-**-6789');
    expect(out.name).toBe('Alice');
  });
});
