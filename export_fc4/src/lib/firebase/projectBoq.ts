import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { nowIso, omitUndefinedDeep } from './ids';
import { getPayItem } from './payItems';

export interface ProjectBoqItem {
  id: string;
  projectId: string;
  payItemId: string;
  payItemVersion: number;
  /** Copied from Pay Item Master at selection time. */
  itemNo: string;
  description: string;
  unit: string;
  programmedQty: number;
  revisedQty: number | null;
  unitPrice: number;
  /** Project-specific weight % (0–100). Optional; UI can compute from amounts. */
  weightPct: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProjectBoqInput = {
  payItemId: string;
  programmedQty: number;
  revisedQty: number | null;
  unitPrice: number;
  weightPct?: number | null;
  active: boolean;
};

function path(projectId: string) {
  return collection(db, COLLECTIONS.projects, projectId, 'boqItems');
}

function firstString(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapBoqItem(projectId: string, id: string, data: Record<string, unknown>): ProjectBoqItem {
  return {
    id,
    projectId,
    payItemId: firstString(data, ['payItemId', 'pay_item_id', 'payItemID']),
    payItemVersion: toFiniteNumber(data.payItemVersion ?? data.pay_item_version, 1),
    itemNo: firstString(data, ['itemNo', 'item_no', 'ItemNo', 'number']),
    description: firstString(data, ['description', 'Description', 'name']),
    unit: firstString(data, ['unit', 'Unit']),
    programmedQty: toFiniteNumber(data.programmedQty ?? data.programmed_qty, 0),
    revisedQty: toNullableNumber(data.revisedQty ?? data.revised_qty),
    unitPrice: toFiniteNumber(data.unitPrice ?? data.unit_price, 0),
    weightPct: toNullableNumber(data.weightPct ?? data.weight_pct),
    active: data.active !== false,
    createdAt: String(data.createdAt ?? data.created_at ?? ''),
    updatedAt: String(data.updatedAt ?? data.updated_at ?? ''),
  };
}

export function projectBoqAmount(
  item: Pick<ProjectBoqItem, 'programmedQty' | 'revisedQty' | 'unitPrice'>,
): number {
  const qty = item.revisedQty != null && item.revisedQty > 0 ? item.revisedQty : item.programmedQty;
  return qty * item.unitPrice;
}

/**
 * Load `projects/{id}/boqItems` — the single source of truth for SWA / IAR / PDM Item No.
 * Hydrates Item No. / Description / Unit from Pay Item Master when legacy rows only store payItemId.
 */
export async function listProjectBoq(projectId: string): Promise<ProjectBoqItem[]> {
  const id = String(projectId || '').trim();
  if (!id || id === '1') return [];

  const snap = await getDocs(path(id));
  let rows = snap.docs.map((item) =>
    mapBoqItem(id, item.id, item.data() as Record<string, unknown>),
  );

  const missingMasterIds = [
    ...new Set(rows.filter((row) => row.payItemId && !row.itemNo).map((row) => row.payItemId)),
  ];
  if (missingMasterIds.length > 0) {
    try {
      const masters = new Map<string, Awaited<ReturnType<typeof getPayItem>>>();
      await Promise.all(
        missingMasterIds.map(async (payItemId) => {
          const master = await getPayItem(payItemId);
          if (master) masters.set(master.id, master);
        }),
      );
      rows = rows.map((row) => {
        if (row.itemNo || !row.payItemId) return row;
        const master = masters.get(row.payItemId);
        if (!master) return row;
        return {
          ...row,
          itemNo: master.itemNo,
          description: row.description || master.description,
          unit: row.unit || master.unit,
          payItemVersion: master.version || row.payItemVersion,
        };
      });
    } catch {
      // Keep raw rows if master list is unavailable (permissions); SWA still shows itemNo when present.
    }
  }

  return rows.sort((a, b) =>
    a.itemNo.localeCompare(b.itemNo, undefined, { numeric: true }),
  );
}

export async function saveProjectBoqItem(
  projectId: string,
  input: ProjectBoqInput,
  id?: string,
) {
  if (!input.payItemId) {
    throw new Error('Select a Pay Item before saving.');
  }

  const master = await getPayItem(input.payItemId);
  if (!master) {
    throw new Error('Selected Pay Item was not found in the master list.');
  }

  const isNew = !id;
  if (isNew && !master.active) {
    throw new Error('Inactive Pay Items cannot be added to a project BOQ.');
  }

  const ref = id ? doc(path(projectId), id) : doc(path(projectId));
  let existingCreatedAt = nowIso();
  if (id) {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const existing = existingSnap.data() as Record<string, unknown>;
      if (existing.createdAt) existingCreatedAt = String(existing.createdAt);
    }
  }

  // Read-only master lookup: copy Item No. / Description / Unit / Version into the project
  // record. Quantity, unit price, amount, and WT% stay on this document only and never write
  // back to the Pay Item Master collection.
  // Firestore rejects `undefined` and `NaN` — coerce everything to safe values.
  const payload = omitUndefinedDeep({
    payItemId: master.id,
    payItemVersion: master.version,
    itemNo: master.itemNo,
    description: master.description,
    unit: master.unit,
    programmedQty: toFiniteNumber(input.programmedQty, 0),
    revisedQty: toNullableNumber(input.revisedQty),
    unitPrice: toFiniteNumber(input.unitPrice, 0),
    weightPct: toNullableNumber(input.weightPct ?? null),
    active: input.active !== false,
    createdAt: existingCreatedAt,
    updatedAt: nowIso(),
  });

  await setDoc(ref, payload);
  return mapBoqItem(projectId, ref.id, payload as Record<string, unknown>);
}

export async function setProjectBoqActive(projectId: string, id: string, active: boolean) {
  await updateDoc(doc(path(projectId), id), { active, updatedAt: nowIso() });
}
