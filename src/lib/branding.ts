/** Match next.config / paths.ts: empty base in local next-dev, `/ConstructFlow` in production. */
const configuredBasePath =
  process.env.NODE_ENV === 'development'
    ? ''
    : (process.env.NEXT_PUBLIC_BASE_PATH ?? '/ConstructFlow').replace(/\/$/, '');

const asset = (path: string) =>
  configuredBasePath ? `${configuredBasePath}${path}` : path;

/** Province of Cagayan — parent agency (PGC seal) */
export const PGC_LOGO = asset('/img/pgc.jpg');

/** Provincial Engineer's Office — client office (PEO seal) */
export const PEO_LOGO = asset('/img/peo.webp');

/** ConstructFlow product mark (icon + wordmark) */
export const SYSTEM_LOGO = `${asset('/img/constructflow_logo.svg')}?v=3`;

export const AGENCY_NAME = 'Province of Cagayan';
export const OFFICE_NAME = "Provincial Engineer's Office";
export const SYSTEM_NAME = 'ConstructFlow';
