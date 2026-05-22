/**
 * Acceptance-criteria smoke test: lists Nango provider configs from the dashboard.
 * Run with: pnpm --filter @cema/integrations-nango list-configs
 *
 * Requires NANGO_SECRET_KEY in env (load .env.local first if running locally).
 */
import { getNango } from '../src/client';

interface Integration {
  unique_key?: string;
  providerConfigKey?: string;
}

async function main() {
  const nango = getNango();
  const raw: unknown = await nango.listIntegrations();
  const result = raw as { data?: Integration[]; configs?: Integration[] };

  const integrations = result.data ?? result.configs ?? [];

  if (integrations.length === 0) {
    console.warn('No provider configs found in Nango dashboard.');
    console.warn('Add integrations at https://app.nango.dev to proceed with Task 10.');
    return;
  }

  console.warn(`Found ${integrations.length} provider config(s):`);
  for (const integration of integrations) {
    const key = integration.unique_key ?? integration.providerConfigKey ?? '(unknown)';
    console.warn(`  • ${key}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
