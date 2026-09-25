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

/** Blank and placeholder marks are not a unit of measure. */
export function isPlaceholderUnit(unit: string | null | undefined): boolean {
  const value = String(unit ?? '').trim().toLowerCase();
  return !value || value === '—' || value === '-' || value === '–' || value === 'n/a';
}

function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function wordKey(word: string): string {
  return word.toLowerCase().replace(/[^a-z.-]/g, '');
}

/**
 * Unit phrases that the pay-item list left on the end of the description
 * whenever the unit column was stored as a placeholder. Phrases come from
 * units already on other rows, plus words that show up as the trailing
 * measure far more often than inside a description.
 */
function discoverUnitPhrases(rows: ReferenceBoqRow[]): string[] {
  const endCount = new Map<string, number>();
  const otherCount = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const row of rows) {
    const parts = wordsOf(row.description);
    parts.forEach((word, index) => {
      const key = wordKey(word);
      if (!key) return;
      if (isPlaceholderUnit(row.unit) && index === parts.length - 1) bump(endCount, key);
      else bump(otherCount, key);
    });
  }

  const unitWords = new Set<string>();
  for (const [key, count] of endCount) {
    if (!/^[a-z][a-z.-]*$/.test(key)) continue;
    if (count >= 2 && count > (otherCount.get(key) ?? 0)) unitWords.add(key);
  }
  for (const row of rows) {
    if (isPlaceholderUnit(row.unit)) continue;
    for (const word of wordsOf(row.unit)) {
      const key = wordKey(word);
      if (key) unitWords.add(key);
    }
  }

  const before = new Map<string, number>();
  const beforeOther = new Map<string, number>();
  for (const row of rows) {
    if (!isPlaceholderUnit(row.unit)) continue;
    const parts = wordsOf(row.description).map(wordKey);
    for (let index = 0; index < parts.length; index += 1) {
      const key = parts[index] ?? '';
      if (!key || unitWords.has(key)) continue;
      const next = parts[index + 1] ?? '';
      if (next && unitWords.has(next)) bump(before, key);
      else bump(beforeOther, key);
    }
  }
  for (const [key, count] of before) {
    if (count >= 10 && count > (beforeOther.get(key) ?? 0)) unitWords.add(key);
  }

  const surface = new Map<string, string>();
  const phraseCount = new Map<string, number>();
  for (const row of rows) {
    if (!isPlaceholderUnit(row.unit)) continue;
    const parts = wordsOf(row.description);
    const keys = parts.map(wordKey);
    for (let size = 1; size <= 3 && size <= parts.length; size += 1) {
      const slice = keys.slice(-size);
      if (slice.some((key) => !key || !unitWords.has(key))) continue;
      const id = slice.join(' ');
      phraseCount.set(id, (phraseCount.get(id) ?? 0) + 1);
      if (!surface.has(id)) surface.set(id, parts.slice(-size).join(' '));
    }
  }

  const canonical = new Map<string, string>();
  for (const row of rows) {
    const unit = String(row.unit ?? '').trim();
    if (!isPlaceholderUnit(unit)) canonical.set(unit.toLowerCase(), unit);
  }

  const phrases = [...phraseCount.entries()]
    .filter(([, count]) => count >= 2)
    .map(([id]) => surface.get(id) ?? id);
  for (const unit of canonical.values()) {
    if (!phrases.some((phrase) => phrase.toLowerCase() === unit.toLowerCase())) phrases.push(unit);
  }
  phrases.sort((a, b) => b.length - a.length);
  return phrases;
}

const UNIT_PHRASES = discoverUnitPhrases([...CUSTOM_BOQ, ...REFERENCE_BOQ]);
const CANONICAL_UNITS = new Map<string, string>();
for (const row of [...CUSTOM_BOQ, ...REFERENCE_BOQ]) {
  const unit = String(row.unit ?? '').trim();
  if (!isPlaceholderUnit(unit) && !CANONICAL_UNITS.has(unit.toLowerCase())) {
    CANONICAL_UNITS.set(unit.toLowerCase(), unit);
  }
}

function peelEmbeddedUnit(description: string, unit: string): { description: string; unit: string } {
  const text = description.trim();
  const current = String(unit ?? '').trim();
  if (!isPlaceholderUnit(current)) return { description: text, unit: current };
  const lower = text.toLowerCase();
  const phrase = UNIT_PHRASES.find((candidate) => {
    const needle = candidate.toLowerCase();
    if (!lower.endsWith(needle)) return false;
    const start = lower.length - needle.length;
    return start === 0 || /\s/.test(lower.charAt(start - 1));
  });
  if (!phrase) return { description: text, unit: '' };
  const nextDescription = text.slice(0, text.length - phrase.length).trim();
  const resolved = CANONICAL_UNITS.get(phrase.toLowerCase()) ?? text.slice(text.length - phrase.length);
  return {
    description: nextDescription || text,
    unit: resolved,
  };
}

/** Use the stored unit, or the measure that was left on the description. */
export function resolveItemUnit(
  itemNo: string,
  description: string,
  unit: string,
): { description: string; unit: string } {
  const direct = peelEmbeddedUnit(description, unit);
  if (!isPlaceholderUnit(direct.unit)) return direct;
  const catalog = lookupWorkItemByItemNo(itemNo);
  if (catalog && !isPlaceholderUnit(catalog.unit)) {
    return {
      description: direct.description || catalog.description,
      unit: catalog.unit,
    };
  }
  return direct;
}

function buildIndex(rows: ReferenceBoqRow[]): Map<string, BoqLookupHit> {
  const map = new Map<string, BoqLookupHit>();
  for (const row of rows) {
    const key = normalizeItemNoKey(row.itemNo);
    if (!key || map.has(key)) continue;
    const resolved = peelEmbeddedUnit(row.description, row.unit);
    map.set(key, {
      itemNo: row.itemNo,
      description: resolved.description,
      unit: resolved.unit,
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

/** Every catalog item number, in list order. Used when the dropdown opens before a search. */
export function listBoqItems(): BoqLookupHit[] {
  return [...CATALOG_INDEX.values()];
}

/** Item-number search. Matches that start with the typed text come first. */
export function searchBoqItems(query: string, limit = 20): BoqLookupHit[] {
  const key = normalizeItemNoKey(query);
  if (!key) return [];
  const starts: BoqLookupHit[] = [];
  const contains: BoqLookupHit[] = [];
  const seen = new Set<string>();
  for (const row of CATALOG) {
    const nk = normalizeItemNoKey(row.itemNo);
    if (!nk.includes(key) || seen.has(nk)) continue;
    const hit = CATALOG_INDEX.get(nk);
    if (!hit) continue;
    seen.add(nk);
    if (nk.startsWith(key)) starts.push(hit);
    else contains.push(hit);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/** Prefix search for datalist (large catalogs — capped). */
export function searchBoqItemNumbers(query: string, limit = 40): string[] {
  return searchBoqItems(query, limit).map((row) => row.itemNo);
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
