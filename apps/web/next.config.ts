import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cema/ui', '@cema/auth', '@cema/db', '@cema/compliance'],
  typedRoutes: true,
};

export default nextConfig;
