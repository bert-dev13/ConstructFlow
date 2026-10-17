/**
 * App base path — must use NEXT_PUBLIC_* only so server and client agree.
 * - local `next dev` → empty
 * - Vercel → empty (do not set NEXT_PUBLIC_BASE_PATH)
 * - Apache/XAMPP → set NEXT_PUBLIC_BASE_PATH=/ConstructFlow
 */
import { publicBasePath } from './publicAsset';

const configuredBasePath = publicBasePath();

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
