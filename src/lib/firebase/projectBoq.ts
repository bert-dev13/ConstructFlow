import { collection, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { nowIso } from './ids';

export interface ProjectBoqItem {
  id: string;
  projectId: string;
  payItemId: string;
  programmedQty: number;
  revisedQty: number | null;
  unitPrice: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function path(projectId: string) {
  return collection(db, COLLECTIONS.projects, projectId, 'boqItems');
}

function mapBoqItem(projectId: string, id: string, data: Record<string, unknown>): ProjectBoqItem {
  return {
    id,
    projectId,
    payItemId: String(data.payItemId ?? ''),
    programmedQty: Number(data.programmedQty ?? 0),
    revisedQty: data.revisedQty == null ? null : Number(data.revisedQty),
    unitPrice: Number(data.unitPrice ?? 0),
    active: data.active !== false,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
  };
}

export async function listProjectBoq(projectId: string): Promise<ProjectBoqItem[]> {
  const snap = await getDocs(path(projectId));
  return snap.docs.map((item) => mapBoqItem(projectId, item.id, item.data() as Record<string, unknown>));
}

export async function saveProjectBoqItem(
  projectId: string,
  input: Omit<ProjectBoqItem, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>,
  id?: string,
) {
  const ref = id ? doc(path(projectId), id) : doc(path(projectId));
  const current = id ? await getDocs(path(projectId)) : null;
  const existing = current?.docs.find((item) => item.id === id)?.data();
  const payload = {
    payItemId: input.payItemId,
    programmedQty: input.programmedQty,
    revisedQty: input.revisedQty,
    unitPrice: input.unitPrice,
    active: input.active,
    createdAt: String(existing?.createdAt ?? nowIso()),
    updatedAt: nowIso(),
  };
  await setDoc(ref, payload);
  return mapBoqItem(projectId, ref.id, payload);
}

export async function setProjectBoqActive(projectId: string, id: string, active: boolean) {
  await updateDoc(doc(path(projectId), id), { active, updatedAt: nowIso() });
}
