import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cema/ui', '@cema/auth', '@cema/db', '@cema/compliance'],
  typedRoutes: true,
  // docusign-esign ships only CommonJS with AMD define() fallback that Turbopack
  // cannot parse. Marking it as a server-side external tells the bundler to
  // require() it at runtime from Node rather than trying to bundle it.
  serverExternalPackages: ['docusign-esign'],
};

export default withWorkflow(nextConfig);
