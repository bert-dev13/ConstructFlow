import type { NextConfig } from 'next';

/**
 * Base path / output:
 * - Vercel (`VERCEL=1`) → root path, Next.js server (dynamic routes)
 * - Local Apache static export → set NEXT_PUBLIC_BASE_PATH=/ConstructFlow
 * - `next dev` → empty base path
 *
 * Client asset URLs must follow NEXT_PUBLIC_BASE_PATH only (see publicAsset.ts).
 */
const onVercel = Boolean(process.env.VERCEL);
const configured = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
const basePath = process.env.NODE_ENV === 'development' ? '' : configured;

const nextConfig: NextConfig = {
  ...(onVercel ? {} : { output: 'export' as const }),
  ...(basePath ? { basePath } : {}),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
