import { describe, expect, it } from 'vitest';

import { normalizeEmail, normalizePhone, normalizeSlackUser } from './normalize';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  BOB@Example.COM  ')).toBe('bob@example.com');
  });

  it('strips +suffix aliases', () => {
    expect(normalizeEmail('bob+notes@example.com')).toBe('bob@example.com');
  });

  it('returns null for malformed input', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('parses a US 10-digit number to E.164', () => {
    expect(normalizePhone('212-555-1234')).toBe('+12125551234');
  });

  it('preserves valid +country E.164 input', () => {
    expect(normalizePhone('+447911123456')).toBe('+447911123456');
  });

  it('handles parentheses and spaces', () => {
    expect(normalizePhone('(212) 555-1234')).toBe('+12125551234');
  });

  it('returns null for invalid input', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('normalizeSlackUser', () => {
  it('lowercases the user id with team prefix', () => {
    expect(normalizeSlackUser('T0123', 'U01ABC')).toBe('t0123:u01abc');
  });
});
