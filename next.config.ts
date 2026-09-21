import type { NextConfig } from 'next';

/** Local `next dev` uses `/` so the landing page opens at localhost:3000. Production/static export keeps `/ConstructFlow` for Apache. */
const configured = (process.env.NEXT_PUBLIC_BASE_PATH ?? '/ConstructFlow').replace(/\/$/, '');
const basePath = process.env.NODE_ENV === 'development' ? '' : configured;

const nextConfig: NextConfig = {
  output: 'export',
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
