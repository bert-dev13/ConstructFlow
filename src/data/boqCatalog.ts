import type { ReferenceBoqRow } from './roadProjectReference';
import catalogJson from './boq/catalog.json';

/**
 * Project BOQ rows — edit src/data/boq/catalog.json (see README in that folder).
 * Merged with the built-in reference BOQ for item-number lookup in SWA forms.
 */
export const CUSTOM_BOQ = catalogJson as ReferenceBoqRow[];
