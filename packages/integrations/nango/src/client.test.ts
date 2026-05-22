import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockNangoConstructor } = vi.hoisted(() => ({
  mockNangoConstructor: vi.fn(),
}));

vi.mock('@nangohq/node', () => ({
  Nango: mockNangoConstructor,
}));

describe('getNango', () => {
  const ORIGINAL_KEY = process.env.NANGO_SECRET_KEY;

  beforeEach(() => {
    vi.resetModules();
    mockNangoConstructor.mockReset();
    mockNangoConstructor.mockImplementation(function (this: object) {
      return this;
    });
  });

  afterEach(() => {
    process.env.NANGO_SECRET_KEY = ORIGINAL_KEY;
  });

  it('throws if NANGO_SECRET_KEY is not set', async () => {
    delete process.env.NANGO_SECRET_KEY;
    const { getNango } = await import('./client');
    expect(() => getNango()).toThrow('NANGO_SECRET_KEY');
  });

  it('returns a Nango instance when the key is set', async () => {
    process.env.NANGO_SECRET_KEY = 'test-key';
    const { getNango } = await import('./client');
    const instance = getNango();
    expect(mockNangoConstructor).toHaveBeenCalledWith({ secretKey: 'test-key' });
    expect(instance).toBeDefined();
  });

  it('returns the same instance on repeated calls (lazy singleton)', async () => {
    process.env.NANGO_SECRET_KEY = 'test-key';
    const { getNango } = await import('./client');
    const a = getNango();
    const b = getNango();
    expect(a).toBe(b);
    expect(mockNangoConstructor).toHaveBeenCalledOnce();
  });
});
