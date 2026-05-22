// DNC (Do Not Call) scrubbing via Gryphon Networks — Phase 3.
// This guard is a no-op in M2. FEATURE_DNC_CHECK_ENABLED gates the real check.
export function dncGuard(_party: { phone?: string | null }): Promise<void> {
  if (process.env.FEATURE_DNC_CHECK_ENABLED === 'true') {
    throw new Error('DNC check not yet implemented — Phase 3');
  }
  return Promise.resolve();
}
