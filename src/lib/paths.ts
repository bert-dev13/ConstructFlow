/** App base path for Apache/XAMPP. Empty in local `next dev`; `/ConstructFlow/` in production builds. */
const configuredBasePath =
  process.env.NODE_ENV === 'development'
    ? ''
    : (process.env.NEXT_PUBLIC_BASE_PATH ?? '/ConstructFlow');

export const BASE_URL = configuredBasePath
  ? `${configuredBasePath.replace(/\/$/, '')}/`
  : '/';

/** React Router basename without trailing slash (`/ConstructFlow` or `''`). */
export const ROUTER_BASENAME = BASE_URL === '/' ? '' : BASE_URL.replace(/\/$/, '');

/** Build an API URL under the current base path. */
export function apiUrl(script: string, query?: string): string {
  const path = `${BASE_URL}api/${script.replace(/^\//, '')}`;
  return query ? `${path}?${query}` : path;
}
