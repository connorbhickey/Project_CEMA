import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR_IDS } from '../constants/error-ids';

// Mock the Sentry SDK at the module boundary. vi.mock intercepts BOTH static and
// dynamic imports of '@sentry/node', so the dynamic `await import('@sentry/node')`
// inside initSentry resolves to these mocks.
const hoisted = vi.hoisted(() => ({
  init: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  init: hoisted.init,
  captureMessage: hoisted.captureMessage,
}));

const DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

describe('sentry seam (DSN-gated, dormant by default)', () => {
  beforeEach(() => {
    // Fresh module state (`initialized`, cached SDK) per test.
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_RUNTIME;
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_RUNTIME;
  });

  it('initSentry no-ops without SENTRY_DSN (dormant)', async () => {
    const { initSentry, captureSwallowedError } = await import('./sentry');

    await expect(initSentry()).resolves.toBe(false);
    expect(hoisted.init).not.toHaveBeenCalled();

    // capture is a no-op too — nothing reaches the SDK.
    captureSwallowedError(ERROR_IDS.AGENT_DISPATCH_FAILED, 'redacted message');
    expect(hoisted.captureMessage).not.toHaveBeenCalled();
  });

  it('initializes once when SENTRY_DSN is set, with PII disabled (idempotent)', async () => {
    process.env.SENTRY_DSN = DSN;
    const { initSentry } = await import('./sentry');

    await expect(initSentry()).resolves.toBe(true);
    await expect(initSentry()).resolves.toBe(true); // idempotent — no second init

    expect(hoisted.init).toHaveBeenCalledTimes(1);
    expect(hoisted.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: DSN, sendDefaultPii: false, maxBreadcrumbs: 0 }),
    );
  });

  it('scrubSentryEvent re-redacts the message and drops PII-bearing auto-context', async () => {
    const { scrubSentryEvent } = await import('./sentry');
    const scrubbed = scrubSentryEvent({
      message: 'failed for SSN 123-45-6789',
      breadcrumbs: [{ message: 'console output' }],
      request: { headers: { cookie: 'secret' } },
      user: { id: 'u1', email: 'a@b.com' },
      extra: { errorId: 'X' },
    });
    expect(scrubbed.message).not.toContain('123-45-6789'); // re-redacted
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.extra).toEqual({ errorId: 'X' }); // non-PII fields preserved
  });

  it('captures a swallowed error as an error-level message with the errorId tag + PII-safe extra', async () => {
    process.env.SENTRY_DSN = DSN;
    const { initSentry, captureSwallowedError } = await import('./sentry');
    await initSentry();

    captureSwallowedError(ERROR_IDS.READ_AUDIT_WRITE_FAILED, 'redacted msg', { dealId: 'deal-1' });

    expect(hoisted.captureMessage).toHaveBeenCalledWith('redacted msg', {
      level: 'error',
      tags: { errorId: 'READ_AUDIT_WRITE_FAILED' },
      extra: { dealId: 'deal-1' },
    });
  });

  it('never throws if the SDK throws (best-effort — the OTel errored span already recorded it)', async () => {
    process.env.SENTRY_DSN = DSN;
    hoisted.captureMessage.mockImplementation(() => {
      throw new Error('sentry unreachable');
    });
    const { initSentry, captureSwallowedError } = await import('./sentry');
    await initSentry();

    expect(() => captureSwallowedError(ERROR_IDS.INTERNAL_COMM_NOTIFY_FAILED, 'm')).not.toThrow();
  });

  it('skips a non-nodejs runtime (the SDK is Node-only)', async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.NEXT_RUNTIME = 'edge';
    const { initSentry } = await import('./sentry');

    await expect(initSentry()).resolves.toBe(false);
    expect(hoisted.init).not.toHaveBeenCalled();
  });
});
