import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { nowIso } from './ids';
import { readListCache, writeListCache, invalidateListCache } from './listCache';

export interface PayItem {
  id: string;
  itemNo: string;
  normalizedItemNo: string;
  description: string;
  unit: string;
  active: boolean;
  version: number;
  uniquenessKey: string;
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

export function payItemUniquenessKey(normalizedItemNo: string, version: number): string {
  return `${normalizedItemNo}::v${version}`;
}

function mapPayItem(id: string, data: Record<string, unknown>): PayItem {
  const itemNo = String(data.itemNo ?? '');
  const normalizedItemNo = String(
    data.normalizedItemNo ?? normalizePayItemNo(itemNo),
  );
  const version = Number(data.version ?? 1);
  return {
    id,
    itemNo,
    normalizedItemNo,
    description: String(data.description ?? ''),
    unit: String(data.unit ?? ''),
    active: data.active !== false,
    version,
    uniquenessKey: String(
      data.uniquenessKey ?? payItemUniquenessKey(normalizedItemNo, version),
    ),
    source: String(data.source ?? 'manual'),
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
    createdBy: data.createdBy != null ? String(data.createdBy) : null,
  };
}

/** Bumped on every mutation so in-flight list fetches cannot re-cache stale snapshots. */
let payItemsEpoch = 0;

function bumpPayItemsCache() {
  payItemsEpoch += 1;
  invalidateListCache('payItems:');
}

async function findByUniquenessKey(key: string): Promise<PayItem | null> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.payItems), where('uniquenessKey', '==', key)),
    );
    if (!snap.empty) {
      const d = snap.docs[0]!;
      return mapPayItem(d.id, d.data() as Record<string, unknown>);
    }
  } catch {
    /* uniquenessKey may be missing on legacy docs */
  }
  // Legacy docs may lack uniquenessKey — fall back to composite scan.
  const all = await listPayItems(true);
  return all.find((item) => item.uniquenessKey === key) ?? null;
}

export async function getPayItem(id: string): Promise<PayItem | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.payItems, id));
  if (!snap.exists()) return null;
  return mapPayItem(snap.id, snap.data() as Record<string, unknown>);
}

/** One in-flight scan per key so several dropdowns cannot each read the whole master list. */
const pendingPayItemLists = new Map<string, Promise<PayItem[]>>();

export async function listPayItems(includeInactive = true): Promise<PayItem[]> {
  const cacheKey = `payItems:${includeInactive ? 'all' : 'active'}`;
  const cached = readListCache<PayItem[]>(cacheKey);
  if (cached) return cached;

  const inflight = pendingPayItemLists.get(cacheKey);
  if (inflight) return inflight;

  const epoch = payItemsEpoch;
  const source = includeInactive
    ? collection(db, COLLECTIONS.payItems)
    : query(collection(db, COLLECTIONS.payItems), where('active', '==', true));
  const promise = getDocs(source).then((snap) => {
    const items = snap.docs
      .map((item) => mapPayItem(item.id, item.data() as Record<string, unknown>))
      .sort((a, b) => a.itemNo.localeCompare(b.itemNo, undefined, { numeric: true }));

    // Mutation landed while this fetch was in flight — discard and re-read.
    if (epoch !== payItemsEpoch) {
      pendingPayItemLists.delete(cacheKey);
      return listPayItems(includeInactive);
    }

    writeListCache(cacheKey, items, 30_000);
    if (includeInactive) {
      writeListCache(
        'payItems:active',
        items.filter((item) => item.active),
        30_000,
      );
    }
    return items;
  }).finally(() => {
    if (pendingPayItemLists.get(cacheKey) === promise) pendingPayItemLists.delete(cacheKey);
  });

  pendingPayItemLists.set(cacheKey, promise);
  return promise;
}

export async function createPayItem(input: PayItemInput, actorId: string): Promise<PayItem> {
  const itemNo = input.itemNo.trim();
  const description = input.description.trim();
  const unit = input.unit.trim();
  const normalizedItemNo = normalizePayItemNo(itemNo);
  if (!normalizedItemNo || !description || !unit) {
    throw new Error('Item No., Description, and Unit are required.');
  }

  const version = 1;
  const uniquenessKey = payItemUniquenessKey(normalizedItemNo, version);
  const existingKey = await findByUniquenessKey(uniquenessKey);
  if (existingKey) {
    throw new Error(`Pay Item ${itemNo} version ${version} already exists.`);
  }

  // One live master row per Item No. (versions bump on the same document).
  const sameNumber = await getDocs(
    query(collection(db, COLLECTIONS.payItems), where('normalizedItemNo', '==', normalizedItemNo)),
  );
  if (!sameNumber.empty) {
    throw new Error(`Pay Item ${itemNo} already exists. Edit it to create a new version.`);
  }

  const ref = doc(collection(db, COLLECTIONS.payItems));
  const timestamp = nowIso();
  const payload = {
    itemNo,
    normalizedItemNo,
    description,
    unit,
    active: true,
    version,
    uniquenessKey,
    source: input.source ?? 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actorId,
  };
  await setDoc(ref, payload);
  bumpPayItemsCache();
  // Warm cache from Firestore so selectors see the new row immediately.
  await listPayItems(true).catch(() => undefined);
  return mapPayItem(ref.id, payload);
}

export async function updatePayItem(
  id: string,
  input: PayItemInput,
  actorId: string,
): Promise<PayItem> {
  const current = await getPayItem(id);
  if (!current) throw new Error('Pay Item not found.');

  const itemNo = input.itemNo.trim();
  const description = input.description.trim();
  const unit = input.unit.trim();
  const normalizedItemNo = normalizePayItemNo(itemNo);
  if (!normalizedItemNo || !description || !unit) {
    throw new Error('Item No., Description, and Unit are required.');
  }

  const contentChanged =
    current.normalizedItemNo !== normalizedItemNo ||
    current.description !== description ||
    current.unit !== unit;

  const nextVersion = contentChanged ? current.version + 1 : current.version;
  const uniquenessKey = payItemUniquenessKey(normalizedItemNo, nextVersion);

  if (contentChanged) {
    const conflict = await findByUniquenessKey(uniquenessKey);
    if (conflict && conflict.id !== id) {
      throw new Error(`Pay Item ${itemNo} version ${nextVersion} already exists.`);
    }
  }

  if (normalizedItemNo !== current.normalizedItemNo) {
    const sameNumber = await getDocs(
      query(collection(db, COLLECTIONS.payItems), where('normalizedItemNo', '==', normalizedItemNo)),
    );
    const other = sameNumber.docs.find((d) => d.id !== id);
    if (other) {
      throw new Error(`Pay Item ${itemNo} already exists.`);
    }
  }

  const payload = {
    itemNo,
    normalizedItemNo,
    description,
    unit,
    version: nextVersion,
    uniquenessKey,
    source: input.source ?? current.source,
    updatedAt: nowIso(),
    updatedBy: actorId,
  };
  await updateDoc(doc(db, COLLECTIONS.payItems, id), payload);
  bumpPayItemsCache();
  await listPayItems(true).catch(() => undefined);
  return { ...current, ...payload, createdBy: current.createdBy };
}

export async function setPayItemActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.payItems, id), {
    active,
    updatedAt: nowIso(),
  });
  bumpPayItemsCache();
  await listPayItems(true).catch(() => undefined);
}

/** Soft-delete: keeps the row in Firestore (Inactive) so project snapshots remain valid. */
export async function deletePayItem(id: string): Promise<void> {
  const current = await getPayItem(id);
  if (!current) throw new Error('Pay Item not found.');
  if (!current.active) {
    throw new Error(`${current.itemNo} is already inactive.`);
  }
  await updateDoc(doc(db, COLLECTIONS.payItems, id), {
    active: false,
    updatedAt: nowIso(),
    deletedAt: nowIso(),
  });
  bumpPayItemsCache();
  await listPayItems(true).catch(() => undefined);
}
