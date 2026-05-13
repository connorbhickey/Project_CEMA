import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cema/ui', '@cema/auth', '@cema/db', '@cema/compliance'],
  // typedRoutes enabled once /dashboard and /sign-in routes are scaffolded
  // typedRoutes: true,
};

export default nextConfig;
