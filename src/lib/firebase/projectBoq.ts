import { collection, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { nowIso } from './ids';
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

function mapBoqItem(projectId: string, id: string, data: Record<string, unknown>): ProjectBoqItem {
  return {
    id,
    projectId,
    payItemId: String(data.payItemId ?? ''),
    payItemVersion: Number(data.payItemVersion ?? 1),
    itemNo: String(data.itemNo ?? ''),
    description: String(data.description ?? ''),
    unit: String(data.unit ?? ''),
    programmedQty: Number(data.programmedQty ?? 0),
    revisedQty: data.revisedQty == null ? null : Number(data.revisedQty),
    unitPrice: Number(data.unitPrice ?? 0),
    weightPct: data.weightPct == null ? null : Number(data.weightPct),
    active: data.active !== false,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
  };
}

export function projectBoqAmount(item: Pick<ProjectBoqItem, 'programmedQty' | 'revisedQty' | 'unitPrice'>): number {
  const qty = item.revisedQty != null && item.revisedQty > 0 ? item.revisedQty : item.programmedQty;
  return qty * item.unitPrice;
}

export async function listProjectBoq(projectId: string): Promise<ProjectBoqItem[]> {
  const snap = await getDocs(path(projectId));
  return snap.docs
    .map((item) => mapBoqItem(projectId, item.id, item.data() as Record<string, unknown>))
    .sort((a, b) => a.itemNo.localeCompare(b.itemNo, undefined, { numeric: true }));
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
    const current = await getDocs(path(projectId));
    const existing = current.docs.find((item) => item.id === id)?.data();
    if (existing?.createdAt) existingCreatedAt = String(existing.createdAt);
  }

  // Read-only master lookup: copy Item No. / Description / Unit / Version into the project
  // record. Quantity, unit price, amount, and WT% stay on this document only and never write
  // back to the Pay Item Master collection.
  const payload = {
    payItemId: master.id,
    payItemVersion: master.version,
    itemNo: master.itemNo,
    description: master.description,
    unit: master.unit,
    programmedQty: input.programmedQty,
    revisedQty: input.revisedQty,
    unitPrice: input.unitPrice,
    weightPct: input.weightPct ?? null,
    active: input.active,
    createdAt: existingCreatedAt,
    updatedAt: nowIso(),
  };
  await setDoc(ref, payload);
  return mapBoqItem(projectId, ref.id, payload);
}

export async function setProjectBoqActive(projectId: string, id: string, active: boolean) {
  await updateDoc(doc(path(projectId), id), { active, updatedAt: nowIso() });
}
