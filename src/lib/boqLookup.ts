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

/**
 * The pay-item list sometimes continues into a footnote, the next item
 * number, a division title, a signature block, or a repeated column header.
 * The unit sits at the end of the item text, before that extra text.
 */
function payItemBody(description: string): string {
  let text = description.trim();
  const stops = [
    text.search(/\*/),
    text.search(/\bDIVISION\b/i),
    text.search(/\s\d{3,4}[A-Za-z]?\s*\(\s*\d+/),
    text.search(/\bDirector\b/),
  ].filter((index) => index > 0);
  if (stops.length) text = text.slice(0, Math.min(...stops)).trim();
  return text.replace(/(?:Thickness\/Sizes\s+)?Size Class Others\s*$/i, '').trim();
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
    const source = isPlaceholderUnit(row.unit) ? payItemBody(row.description) : row.description;
    const parts = wordsOf(source);
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
    if (count >= 1 && count > (otherCount.get(key) ?? 0)) unitWords.add(key);
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
    const parts = wordsOf(payItemBody(row.description)).map(wordKey);
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
    const parts = wordsOf(payItemBody(row.description));
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
    .filter(([id, count]) => count >= (id.includes(' ') ? 2 : 1))
    .map(([id]) => surface.get(id) ?? id);
  for (const unit of canonical.values()) {
    if (!phrases.some((phrase) => phrase.toLowerCase() === unit.toLowerCase())) phrases.push(unit);
  }
  phrases.sort((a, b) => b.length - a.length);
  return phrases;
}

const UNIT_PHRASES = discoverUnitPhrases([...CUSTOM_BOQ, ...REFERENCE_BOQ]);

/** Words that only ever introduce a meter measure, such as Cubic or Square. */
function meterModifiers(rows: ReferenceBoqRow[]): Set<string> {
  const followedBy = new Map<string, Set<string>>();
  const seen = new Map<string, number>();
  for (const row of rows) {
    const parts = wordsOf(`${row.description} ${row.unit}`).map(wordKey);
    for (let index = 0; index < parts.length; index += 1) {
      const word = parts[index] ?? '';
      if (!word) continue;
      seen.set(word, (seen.get(word) ?? 0) + 1);
      const next = followedBy.get(word) ?? new Set<string>();
      next.add(parts[index + 1] ?? '');
      followedBy.set(word, next);
    }
  }
  const modifiers = new Set<string>();
  for (const [word, next] of followedBy) {
    const meterOnly = [...next].every(
      (token) => token === 'meter' || token === 'meters' || token.startsWith('meter'),
    );
    if (meterOnly && (seen.get(word) ?? 0) >= 2) modifiers.add(word);
  }
  return modifiers;
}

const METER_MODIFIERS = meterModifiers([...CUSTOM_BOQ, ...REFERENCE_BOQ]);
const CANONICAL_UNITS = new Map<string, string>();
for (const row of [...CUSTOM_BOQ, ...REFERENCE_BOQ]) {
  const unit = String(row.unit ?? '').trim();
  if (!isPlaceholderUnit(unit) && !CANONICAL_UNITS.has(unit.toLowerCase())) {
    CANONICAL_UNITS.set(unit.toLowerCase(), unit);
  }
}

function unitSuffix(text: string): { description: string; unit: string } | null {
  const lower = text.toLowerCase();
  let phrase = UNIT_PHRASES.find((candidate) => {
    const needle = candidate.toLowerCase();
    if (!lower.endsWith(needle)) return false;
    const start = lower.length - needle.length;
    return start === 0 || /\s/.test(lower.charAt(start - 1));
  });
  if (!phrase) return null;
  const parts = wordsOf(text);
  const phraseWords = wordsOf(phrase);
  if (phraseWords.length === 1 && /^(meter|meters)$/i.test(phrase)) {
    const previous = parts[parts.length - phraseWords.length - 1];
    if (previous && METER_MODIFIERS.has(wordKey(previous))) {
      phrase = `${previous} ${phrase}`;
    }
  }
  const nextDescription = text.slice(0, text.length - phrase.length).trim();
  const resolved = CANONICAL_UNITS.get(phrase.toLowerCase()) ?? text.slice(text.length - phrase.length);
  return {
    description: nextDescription || text,
    unit: resolved,
  };
}

function peelEmbeddedUnit(description: string, unit: string): { description: string; unit: string } {
  const text = description.trim();
  const current = String(unit ?? '').trim();
  if (!isPlaceholderUnit(current)) return { description: text, unit: current };
  const direct = unitSuffix(text);
  if (direct && !isPlaceholderUnit(direct.unit)) return direct;
  const body = payItemBody(text);
  const source = body || text;
  if (source !== text) {
    const recovered = unitSuffix(source);
    if (recovered && !isPlaceholderUnit(recovered.unit)) return recovered;
  }
  const lone = loneMeasure(source);
  if (lone) return lone;
  const sibling = unitFromSiblingDescription(source);
  if (sibling) return sibling;
  return { description: text, unit: '' };
}

/** A description that is only the measure, such as "Kilometer". */
function loneMeasure(text: string): { description: string; unit: string } | null {
  const parts = wordsOf(text);
  if (parts.length !== 1) return null;
  const word = parts[0]!;
  const key = wordKey(word);
  if (!key) return null;
  const alreadyADescriptionEnding = CATALOG.some((row) => {
    if (isPlaceholderUnit(row.unit)) return false;
    const desc = wordsOf(row.description);
    return wordKey(desc[desc.length - 1] ?? '') === key;
  });
  if (alreadyADescriptionEnding) return null;
  return { description: text, unit: word };
}

/**
 * "Structure Span" next to a sibling whose description is "Structure"
 * means the extra word is the unit the list failed to split off.
 */
function unitFromSiblingDescription(text: string): { description: string; unit: string } | null {
  const parts = wordsOf(text);
  if (parts.length < 2) return null;
  const stem = parts.slice(0, -1).join(' ');
  const token = parts[parts.length - 1]!;
  const stemKey = stem.toLowerCase();
  const sibling = CATALOG.some(
    (row) => !isPlaceholderUnit(row.unit) && row.description.trim().toLowerCase() === stemKey,
  );
  if (!sibling) return null;
  return { description: stem, unit: token };
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
