import { doc, getDoc } from 'firebase/firestore';
import type { Role } from '../../types';
import { COLLECTIONS } from './collections';
import { auth, db } from './config';
import { readListCache, writeListCache } from './listCache';

export interface ProjectAccessState {
  contractorId: string | null;
  assignedUserIds: string[];
  involvedUserIds: string[];
  accessUserIds: string[];
}

export interface AccessContext {
  uid: string;
  role: Role;
  hasGlobalProjectAccess: boolean;
}

function normalizeUid(value: unknown): string | null {
  const uid = typeof value === 'string' ? value.trim() : '';
  return uid ? uid : null;
}

export function uniqueUserIds(values: unknown[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const uid = normalizeUid(value);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    ids.push(uid);
  }
  return ids;
}

function normalizeUserIdArray(value: unknown): string[] {
  return Array.isArray(value) ? uniqueUserIds(value) : [];
}

export function roleHasGlobalProjectAccess(role: Role | null | undefined) {
  // REVISIONS: only Engineer III and IV see every project.
  // Engineer I / II and contractors are limited to assigned / involved projects.
  return role === 'engineer_3' || role === 'engineer_4';
}

export function buildProjectAccess(input: {
  contractorId?: string | null;
  assignedUserIds?: unknown;
  involvedUserIds?: unknown;
}): ProjectAccessState {
  const contractorId = normalizeUid(input.contractorId) ?? null;
  const assignedUserIds = uniqueUserIds([
    ...(Array.isArray(input.assignedUserIds) ? input.assignedUserIds : []),
    contractorId,
  ]);
  const involvedUserIds = normalizeUserIdArray(input.involvedUserIds);
  return {
    contractorId,
    assignedUserIds,
    involvedUserIds,
    accessUserIds: uniqueUserIds([contractorId, ...assignedUserIds, ...involvedUserIds]),
  };
}

export function readProjectAccess(data: Record<string, unknown>): ProjectAccessState {
  return buildProjectAccess({
    contractorId: typeof data.contractorId === 'string' ? data.contractorId : null,
    assignedUserIds: data.assignedUserIds,
    involvedUserIds: data.involvedUserIds,
  });
}

function projectIdsFromUserData(data: Record<string, unknown>): string[] {
  return uniqueUserIds([
    ...(Array.isArray(data.accessibleProjectIds) ? data.accessibleProjectIds : []),
    ...(Array.isArray(data.assignedProjectIds) ? data.assignedProjectIds : []),
    ...(Array.isArray(data.involvedProjectIds) ? data.involvedProjectIds : []),
  ]);
}

export async function getAccessContext(): Promise<AccessContext | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;

  const cacheKey = `access:${uid}`;
  const cached = readListCache<AccessContext>(cacheKey);
  if (cached) return cached;

  const snap = await getDoc(doc(db, COLLECTIONS.users, uid));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  const role = data.role as Role | undefined;
  if (!role) return null;

  const ctx: AccessContext = {
    uid,
    role,
    hasGlobalProjectAccess: roleHasGlobalProjectAccess(role),
  };
  writeListCache(cacheKey, ctx, 30_000);
  writeListCache(`projectIds:${uid}`, projectIdsFromUserData(data), 30_000);
  return ctx;
}

/** Project IDs stored on the user profile (fast path when list queries are denied). */
export async function getAccessibleProjectIds(uid?: string): Promise<string[]> {
  const resolvedUid = uid ?? auth.currentUser?.uid;
  if (!resolvedUid) return [];

  const cacheKey = `projectIds:${resolvedUid}`;
  const cached = readListCache<string[]>(cacheKey);
  if (cached) return cached;

  const snap = await getDoc(doc(db, COLLECTIONS.users, resolvedUid));
  if (!snap.exists()) return [];
  const ids = projectIdsFromUserData(snap.data() as Record<string, unknown>);
  return writeListCache(cacheKey, ids, 30_000);
}
