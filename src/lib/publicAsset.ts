/**
 * Public asset base path shared by server + client bundles.
 *
 * Important: do not rely on `process.env.VERCEL` here — it is server-only and
 * causes client code to fall back to `/ConstructFlow/...`, which 404s on Vercel.
 *
 * - local `next dev` → empty
 * - Vercel → empty (omit NEXT_PUBLIC_BASE_PATH)
 * - Apache/XAMPP static export → set NEXT_PUBLIC_BASE_PATH=/ConstructFlow
 */
export function publicBasePath(): string {
  if (process.env.NODE_ENV === 'development') return '';
  return (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
}

export function publicAsset(path: string): string {
  const base = publicBasePath();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}
