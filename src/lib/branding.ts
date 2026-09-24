import { publicAsset } from './publicAsset';

/** Province of Cagayan — parent agency (PGC seal) */
export const PGC_LOGO = publicAsset('/img/pgc.jpg');

/** Provincial Engineer's Office — client office (PEO seal) */
export const PEO_LOGO = publicAsset('/img/peo.webp');

/** ConstructFlow product mark — optimized webp (legacy SVG was a 1.2MB embedded PNG). */
export const SYSTEM_LOGO = `${publicAsset('/img/constructflow_logo.webp')}?v=4`;

/** Raster fallback if webp is unavailable */
export const SYSTEM_LOGO_FALLBACK = `${publicAsset('/img/constructflow_logo.sm.png')}?v=4`;

export const AGENCY_NAME = 'Province of Cagayan';
export const OFFICE_NAME = "Provincial Engineer's Office";
export const SYSTEM_NAME = 'ConstructFlow';
