import { CUSTOM_BOQ } from '../data/boqCatalog';
import { REFERENCE_BOQ, type ReferenceBoqRow } from '../data/roadProjectReference';

export interface BoqLookupHit {
  itemNo: string;
  description: string;
  unit: string;
  unitCost: number;
  qty: number;
}

export function normalizeItemNoKey(itemNo: string): string {
  return itemNo.trim().replace(/\s+/g, '').toLowerCase();
}

function buildIndex(rows: ReferenceBoqRow[]): Map<string, BoqLookupHit> {
  const map = new Map<string, BoqLookupHit>();
  for (const row of rows) {
    const key = normalizeItemNoKey(row.itemNo);
    if (!key || map.has(key)) continue;
    map.set(key, {
      itemNo: row.itemNo,
      description: row.description,
      unit: row.unit,
      unitCost: row.unitCost,
      qty: row.qty,
    });
  }
  return map;
}

const CATALOG = [...CUSTOM_BOQ, ...REFERENCE_BOQ];
const CATALOG_INDEX = buildIndex(CATALOG);

export function lookupWorkItemByItemNo(itemNo: string): BoqLookupHit | null {
  const trimmed = itemNo.trim();
  if (!trimmed) return null;

  const hit = CATALOG_INDEX.get(normalizeItemNoKey(trimmed));
  if (hit) return hit;

  const exact = CATALOG.find((row) => row.itemNo.trim() === trimmed);
  if (!exact) return null;
  return {
    itemNo: exact.itemNo,
    description: exact.description,
    unit: exact.unit,
    unitCost: exact.unitCost,
    qty: exact.qty,
  };
}

/** Prefix search for datalist (large catalogs — capped). */
export function searchBoqItemNumbers(query: string, limit = 40): string[] {
  const key = normalizeItemNoKey(query);
  if (key.length < 2) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of CATALOG) {
    const no = row.itemNo;
    const nk = normalizeItemNoKey(no);
    if (!nk.includes(key)) continue;
    const sk = nk;
    if (seen.has(sk)) continue;
    seen.add(sk);
    out.push(no);
    if (out.length >= limit) break;
  }
  return out;
}

export function boqCatalogSize(): number {
  return CATALOG.length;
}

/** Fields to auto-fill from the BOQ when a matching item number is entered. */
export function workItemPatchFromBoq(
  itemNo: string,
  current: { unitPrice: number; programmedQty: number },
): Partial<{
  itemNo: string;
  description: string;
  unit: string;
  unitPrice: number;
  programmedQty: number;
}> | null {
  const hit = lookupWorkItemByItemNo(itemNo);
  if (!hit) return null;

  return {
    itemNo: hit.itemNo,
    description: hit.description,
    unit: hit.unit,
    unitPrice: current.unitPrice > 0 ? current.unitPrice : hit.unitCost,
    programmedQty: current.programmedQty > 0 ? current.programmedQty : hit.qty,
  };
}
