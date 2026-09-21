import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { nowIso } from './ids';

export interface PayItem {
  id: string;
  itemNo: string;
  normalizedItemNo: string;
  description: string;
  unit: string;
  active: boolean;
  version: number;
  source: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface PayItemInput {
  itemNo: string;
  description: string;
  unit: string;
  source?: string;
}

export function normalizePayItemNo(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '').replace(/[.()[\]{}-]/g, '');
}

function mapPayItem(id: string, data: Record<string, unknown>): PayItem {
  return {
    id,
    itemNo: String(data.itemNo ?? ''),
    normalizedItemNo: String(data.normalizedItemNo ?? normalizePayItemNo(String(data.itemNo ?? ''))),
    description: String(data.description ?? ''),
    unit: String(data.unit ?? ''),
    active: data.active !== false,
    version: Number(data.version ?? 1),
    source: String(data.source ?? 'manual'),
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
    createdBy: data.createdBy != null ? String(data.createdBy) : null,
  };
}

export async function listPayItems(includeInactive = true): Promise<PayItem[]> {
  const source = includeInactive
    ? collection(db, COLLECTIONS.payItems)
    : query(collection(db, COLLECTIONS.payItems), where('active', '==', true));
  const snap = await getDocs(source);
  return snap.docs
    .map((item) => mapPayItem(item.id, item.data() as Record<string, unknown>))
    .sort((a, b) => a.itemNo.localeCompare(b.itemNo, undefined, { numeric: true }));
}

export async function createPayItem(input: PayItemInput, actorId: string): Promise<PayItem> {
  const normalizedItemNo = normalizePayItemNo(input.itemNo);
  if (!normalizedItemNo || !input.description.trim() || !input.unit.trim()) {
    throw new Error('Item No., Description, and Unit are required.');
  }
  const duplicate = await getDocs(
    query(collection(db, COLLECTIONS.payItems), where('normalizedItemNo', '==', normalizedItemNo)),
  );
  if (!duplicate.empty) throw new Error(`Pay Item ${input.itemNo} already exists.`);

  const ref = doc(collection(db, COLLECTIONS.payItems));
  const timestamp = nowIso();
  const payload = {
    itemNo: input.itemNo.trim(),
    normalizedItemNo,
    description: input.description.trim(),
    unit: input.unit.trim(),
    active: true,
    version: 1,
    source: input.source ?? 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actorId,
  };
  await setDoc(ref, payload);
  return mapPayItem(ref.id, payload);
}

export async function updatePayItem(
  id: string,
  input: PayItemInput,
  actorId: string,
): Promise<PayItem> {
  const normalizedItemNo = normalizePayItemNo(input.itemNo);
  const all = await listPayItems();
  const duplicate = all.find((item) => item.id !== id && item.normalizedItemNo === normalizedItemNo);
  if (duplicate) throw new Error(`Pay Item ${input.itemNo} already exists.`);
  const current = all.find((item) => item.id === id);
  if (!current) throw new Error('Pay Item not found.');
  const payload = {
    itemNo: input.itemNo.trim(),
    normalizedItemNo,
    description: input.description.trim(),
    unit: input.unit.trim(),
    version: current.version + 1,
    source: input.source ?? current.source,
    updatedAt: nowIso(),
    updatedBy: actorId,
  };
  await updateDoc(doc(db, COLLECTIONS.payItems, id), payload);
  return { ...current, ...payload, createdBy: current.createdBy };
}

export async function setPayItemActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.payItems, id), {
    active,
    updatedAt: nowIso(),
  });
}
