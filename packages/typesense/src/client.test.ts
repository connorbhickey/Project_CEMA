import { describe, expect, it, vi } from 'vitest';

vi.mock('typesense', () => ({
  default: { Client: vi.fn().mockImplementation(() => ({ health: vi.fn() })) },
  Client: vi.fn().mockImplementation(() => ({ health: vi.fn() })),
}));

import { getTypesenseClient, isTypesenseConfigured } from './client';

describe('isTypesenseConfigured', () => {
  it('returns false when TYPESENSE_API_KEY is not set', () => {
    const orig = process.env.TYPESENSE_API_KEY;
    delete process.env.TYPESENSE_API_KEY;
    expect(isTypesenseConfigured()).toBe(false);
    process.env.TYPESENSE_API_KEY = orig;
  });

  it('returns true when TYPESENSE_API_KEY is set', () => {
    process.env.TYPESENSE_API_KEY = 'test-key';
    expect(isTypesenseConfigured()).toBe(true);
    delete process.env.TYPESENSE_API_KEY;
  });
});

describe('getTypesenseClient', () => {
  it('throws when TYPESENSE_API_KEY is not set', () => {
    delete process.env.TYPESENSE_API_KEY;
    expect(() => getTypesenseClient()).toThrow('TYPESENSE_API_KEY');
  });
});
