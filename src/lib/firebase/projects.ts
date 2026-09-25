import {
  addDoc,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { COLLECTIONS, projectAuditPath, projectContractHistoryPath } from './collections';
import { buildProjectAccess, getAccessContext, getAccessibleProjectIds, readProjectAccess, uniqueUserIds } from './access';
import { chunkIds, mapPool, readListCache, writeListCache, invalidateListCache } from './listCache';
import { db } from './config';
import { asId, nowIso, omitUndefined } from './ids';
import type {
  ContractHistoryEntry,
  ContractorOption,
  ProjectAuditEntry,
  ProjectInput,
  ProjectListOptions,
  ProjectReportDefaults,
  ProjectRow,
} from '../projectsApi';

type LifecycleState = 'active' | 'pending_delete_approval' | 'archived';

function lifecycleStateOf(data: Record<string, unknown>): LifecycleState {
  const state = String(data.lifecycleState ?? 'active');
  if (state === 'pending_delete_approval' || state === 'archived') return state;
  return 'active';
}

/** Calendar day as YYYY-MM-DD. A date-only string is kept as written so it cannot shift a day. */
export function toCalendarDate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
  }
  if (typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === 'function') {
      const date = (toDate as () => Date).call(value);
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    }
  }
  return null;
}

function futureIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

async function writeProjectAudit(
  projectId: string,
  fieldName: string,
  oldValue: unknown,
  newValue: unknown,
  actorName?: string,
) {
  await addDoc(collection(db, projectAuditPath(projectId)), {
    fieldName,
    oldValue: oldValue != null ? String(oldValue) : null,
    newValue: newValue != null ? String(newValue) : null,
    createdAt: nowIso(),
    actorName: actorName ?? null,
  });
}

async function queueProjectEmail(projectId: string, event: string, extra: Record<string, unknown> = {}) {
  await addDoc(collection(db, COLLECTIONS.emailQueue), {
    projectId,
    event,
    status: 'queued',
    ...extra,
    createdAt: nowIso(),
  });
}

function mapProject(id: string, data: Record<string, unknown>): ProjectRow {
  const access = readProjectAccess(data);
  return {
    id,
    name: String(data.name ?? ''),
    location: (data.location as string | null) ?? null,
    status: String(data.status ?? 'active'),
    lifecycle_state: lifecycleStateOf(data),
    archive_owner_id: data.archiveOwnerId != null ? asId(data.archiveOwnerId as string) : null,
    archive_owner_role: (data.archiveOwnerRole as string | null) ?? null,
    archived_at: (data.archivedAt as string | null) ?? null,
    purge_after: (data.purgeAfter as string | null) ?? null,
    deletion_approval:
      (data.deletionApproval as Record<string, unknown> | null | undefined) ?? null,
    start_date: toCalendarDate(data.startDate),
    planned_end_date: toCalendarDate(data.plannedEndDate),
    baseline_mode: data.baselineMode === 'prior_suspension' ? 'prior_suspension' : 'active',
    contact_details: data.contactDetails != null ? String(data.contactDetails) : null,
    revised_completion_date: toCalendarDate(data.revisedCompletionDate),
    suspension_start_date: toCalendarDate(data.suspensionStartDate),
    suspension_end_date: toCalendarDate(data.suspensionEndDate),
    contractor_id: data.contractorId != null ? asId(data.contractorId as string) : null,
    contractor_name: (data.contractorName as string | null) ?? null,
    contract_amount: data.contractAmount != null ? Number(data.contractAmount) : null,
    assigned_user_ids: access.assignedUserIds,
    involved_user_ids: access.involvedUserIds,
    created_at: (data.createdAt as string | null) ?? null,
    updated_at: (data.updatedAt as string | null) ?? null,
  };
}

async function syncUserProjectMembership(
  projectId: string,
  nextAccess: ReturnType<typeof buildProjectAccess>,
  prevAccess?: ReturnType<typeof readProjectAccess>,
) {
  const prevAssigned = new Set(prevAccess?.assignedUserIds ?? []);
  const prevInvolved = new Set(prevAccess?.involvedUserIds ?? []);
  const prevAll = new Set([...(prevAccess?.accessUserIds ?? [])]);
  const nextAssigned = new Set(nextAccess.assignedUserIds);
  const nextInvolved = new Set(nextAccess.involvedUserIds);
  const nextAll = new Set(nextAccess.accessUserIds);
  const touched = uniqueUserIds([...prevAll, ...nextAll]);

  await Promise.all(
    touched.map(async (uid) => {
      const userRef = doc(db, COLLECTIONS.users, uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      const role = String(data.role ?? '');
      if (role === 'engineer_3' || role === 'engineer_4') return;

      const assigned = new Set(
        Array.isArray(data.assignedProjectIds) ? data.assignedProjectIds.map(String) : [],
      );
      const involved = new Set(
        Array.isArray(data.involvedProjectIds) ? data.involvedProjectIds.map(String) : [],
      );
      const accessible = new Set(
        Array.isArray(data.accessibleProjectIds) ? data.accessibleProjectIds.map(String) : [],
      );

      if (nextAssigned.has(uid)) assigned.add(projectId);
      else if (prevAssigned.has(uid)) assigned.delete(projectId);

      if (nextInvolved.has(uid)) involved.add(projectId);
      else if (prevInvolved.has(uid)) involved.delete(projectId);

      if (nextAll.has(uid)) accessible.add(projectId);
      else if (prevAll.has(uid)) accessible.delete(projectId);

      // Contractors also keep the project via contractorId membership.
      if (nextAccess.contractorId === uid) {
        accessible.add(projectId);
      }

      await updateDoc(userRef, {
        assignedProjectIds: [...assigned],
        involvedProjectIds: [...involved],
        accessibleProjectIds: [...accessible],
        updatedAt: nowIso(),
      });
      invalidateListCache(`projectIds:${uid}`);
      invalidateListCache(`projects:${uid}:`);
    }),
  );
}

async function resolveContractorName(contractorId: string | null | undefined) {
  if (!contractorId) return null;
  const snap = await getDoc(doc(db, COLLECTIONS.users, contractorId));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  return String(data.fullName ?? data.name ?? '');
}

function matchesProjectView(project: ProjectRow, view: ProjectListOptions['view']) {
  if (view === 'archived') return project.lifecycle_state === 'archived';
  if (view === 'all') return true;
  return project.lifecycle_state !== 'archived';
}

export async function listProjectsFs(options?: ProjectListOptions): Promise<ProjectRow[]> {
  const access = await getAccessContext();
  if (!access) return [];

  const view = options?.view ?? 'active';
  const cacheKey = `projects:${access.uid}:${view}`;
  const cached = readListCache<ProjectRow[]>(cacheKey);
  // An empty cache is not reused. A denied membership query used to cache []
  // and Prepare Schedule then stayed on "Waiting for a project".
  if (cached && cached.length > 0) return cached;

  // Reuse the unfiltered set when another view was already loaded.
  const allKey = `projects:${access.uid}:all`;
  const allCached = readListCache<ProjectRow[]>(allKey);
  if (allCached && allCached.length > 0) {
    const filteredFromAll = allCached.filter((row) => matchesProjectView(row, view));
    filteredFromAll.sort((a, b) =>
      (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? ''),
    );
    return writeListCache(cacheKey, filteredFromAll, 20_000);
  }

  const loadByPointers = async () => {
    const uniqueIds = await getAccessibleProjectIds(access.uid);
    if (!uniqueIds.length) return [] as ProjectRow[];
    const chunks = chunkIds(uniqueIds, 30);
    const snaps = await mapPool(chunks, 4, async (chunk) => {
      try {
        return await getDocs(
          query(collection(db, COLLECTIONS.projects), where(documentId(), 'in', chunk)),
        );
      } catch {
        const perId = await mapPool(chunk, 8, async (projectId) => {
          try {
            return await getDoc(doc(db, COLLECTIONS.projects, projectId));
          } catch {
            return null;
          }
        });
        return {
          docs: perId
            .filter((snap): snap is NonNullable<typeof snap> => Boolean(snap?.exists()))
            .map((snap) => ({ id: snap.id, data: () => snap.data() })),
        };
      }
    });
    return snaps.flatMap((snap) =>
      snap.docs.map((d) => mapProject(d.id, d.data() as Record<string, unknown>)),
    );
  };

  let rows: ProjectRow[] = [];
  if (access.hasGlobalProjectAccess) {
    try {
      const snap = await getDocs(collection(db, COLLECTIONS.projects));
      rows = snap.docs.map((d) => mapProject(d.id, d.data() as Record<string, unknown>));
    } catch {
      rows = await loadByPointers();
    }
  } else {
    // Merge profile pointers with live membership so assigned users see every
    // project even when user-doc pointers lag behind the project document.
    const byId = new Map<string, ProjectRow>();
    const addDocs = (docs: Array<{ id: string; data: () => Record<string, unknown> }>) => {
      for (const d of docs) byId.set(d.id, mapProject(d.id, d.data()));
    };

    // Contractors are stored on contractorId (auth uid). That equality query is
    // allowed by project read rules. The accessUserIds array-contains query is
    // denied, and syncing the contractor's user doc from Engineer I is also
    // denied, so profile pointers stay empty. Run this first.
    if (access.role === 'contractor') {
      try {
        const snap = await getDocs(
          query(collection(db, COLLECTIONS.projects), where('contractorId', '==', access.uid)),
        );
        addDocs(snap.docs);
      } catch {
        /* fall through to pointer / accessUserIds membership */
      }
    }

    try {
      for (const row of await loadByPointers()) byId.set(row.id, row);
    } catch {
      /* profile pointers are optional */
    }
    try {
      const snap = await getDocs(
        query(collection(db, COLLECTIONS.projects), where('accessUserIds', 'array-contains', access.uid)),
      );
      addDocs(snap.docs);
    } catch {
      /* rules may reject this list shape; contractorId query still applies */
    }
    if (access.role === 'contractor') {
      try {
        const snap = await getDocs(
          query(collection(db, COLLECTIONS.projects), where('assignedUserIds', 'array-contains', access.uid)),
        );
        addDocs(snap.docs);
      } catch {
        /* optional; contractorId is the assignment field */
      }
    }
    rows = [...byId.values()];
    if (access.role === 'contractor' && rows.length > 0) {
      void rememberContractorProjectIds(
        access.uid,
        rows.map((row) => row.id),
      );
    }
  }

  // Cache the unfiltered accessible set, then return the requested view.
  // Never cache an empty list — that hid newly assigned projects for the TTL.
  if (rows.length > 0) writeListCache(allKey, rows, 20_000);
  const filtered = rows.filter((row) => matchesProjectView(row, view));
  filtered.sort((a, b) =>
    (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? ''),
  );
  if (filtered.length === 0) return filtered;
  return writeListCache(cacheKey, filtered, 20_000);
}

/** Contractor can update their own user doc. Engineer I cannot, so pointers lag. */
async function rememberContractorProjectIds(uid: string, projectIds: string[]) {
  const userRef = doc(db, COLLECTIONS.users, uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;
  const data = snap.data() as Record<string, unknown>;
  const accessible = new Set(
    Array.isArray(data.accessibleProjectIds) ? data.accessibleProjectIds.map(String) : [],
  );
  const assigned = new Set(
    Array.isArray(data.assignedProjectIds) ? data.assignedProjectIds.map(String) : [],
  );
  let changed = false;
  for (const projectId of projectIds) {
    if (!accessible.has(projectId)) {
      accessible.add(projectId);
      changed = true;
    }
    if (!assigned.has(projectId)) {
      assigned.add(projectId);
      changed = true;
    }
  }
  if (!changed) return;
  try {
    await updateDoc(userRef, {
      accessibleProjectIds: [...accessible],
      assignedProjectIds: [...assigned],
      updatedAt: nowIso(),
    });
    invalidateListCache(`projectIds:${uid}`);
  } catch {
    /* The signed-in contractor may be offline. The contractorId query still lists projects. */
  }
}

async function listUsersByRole(role: 'contractor' | 'engineer_1' | 'engineer_2'): Promise<ContractorOption[]> {
  const q = query(collection(db, COLLECTIONS.users), where('role', '==', role));
  const snap = await getDocs(q);

  // One entry per email. Skip inactive / incomplete profiles so legacy seed leftovers
  // do not appear in project assignment dropdowns.
  const byEmail = new Map<string, ContractorOption>();

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.isActive === false) continue;

    const email = String(data.email ?? '').trim();
    const emailKey = email.toLowerCase();
    if (!emailKey || !emailKey.includes('@')) continue;

    const fullName = String(data.fullName ?? data.name ?? '').trim();
    if (!fullName) continue;

    const option: ContractorOption = {
      id: d.id,
      full_name: fullName,
      email,
    };

    const existing = byEmail.get(emailKey);
    if (!existing) {
      byEmail.set(emailKey, option);
      continue;
    }

    // Prefer ConstructFlow demo/official emails when the same address exists twice.
    const preferNew =
      emailKey.startsWith('constructflow.') && !existing.email.toLowerCase().startsWith('constructflow.');
    if (preferNew) byEmail.set(emailKey, option);
  }

  return [...byEmail.values()].sort((a, b) =>
    a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' }),
  );
}

export async function listContractorsFs(): Promise<ContractorOption[]> {
  return listUsersByRole('contractor');
}

export async function listEngineerOnesFs(): Promise<ContractorOption[]> {
  return listUsersByRole('engineer_1');
}

export async function listEngineerTwosFs(): Promise<ContractorOption[]> {
  return listUsersByRole('engineer_2');
}

export async function getProjectFs(id: string | number) {
  const projectId = asId(id);
  const snap = await getDoc(doc(db, COLLECTIONS.projects, projectId));
  if (!snap.exists()) throw new Error('Project not found');
  const project = mapProject(snap.id, snap.data() as Record<string, unknown>);

  const auditSnap = await getDocs(collection(db, projectAuditPath(projectId)));
  const audit_log: ProjectAuditEntry[] = auditSnap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      field_name: String(data.fieldName ?? ''),
      old_value: (data.oldValue as string | null) ?? null,
      new_value: (data.newValue as string | null) ?? null,
      created_at: String(data.createdAt ?? ''),
      actor_name: (data.actorName as string | null) ?? null,
    };
  });
  audit_log.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const histSnap = await getDocs(collection(db, projectContractHistoryPath(projectId)));
  const contract_history: ContractHistoryEntry[] = histSnap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      contract_amount: Number(data.contractAmount ?? 0),
      effective_date: String(data.effectiveDate ?? ''),
      vo_reference: (data.voReference as string | null) ?? null,
      notes: (data.notes as string | null) ?? null,
      created_at: String(data.createdAt ?? ''),
      created_by_name: (data.createdByName as string | null) ?? null,
    };
  });
  contract_history.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const report_defaults: ProjectReportDefaults = {
    contractor: project.contractor_name ?? '',
    start_date: project.start_date ?? null,
    contract_amount: project.contract_amount != null ? String(project.contract_amount) : null,
    project_name: project.name,
    location: project.location,
  };

  return { project, audit_log, contract_history, report_defaults };
}

export async function createProjectFs(input: ProjectInput, actorName?: string) {
  const access = await getAccessContext();
  const contractorId = input.contractor_id != null ? asId(input.contractor_id) : null;
  const contractorName = await resolveContractorName(contractorId);
  const assignedFromInput = Array.isArray(input.assigned_user_ids)
    ? input.assigned_user_ids.map((id) => asId(id))
    : [];
  let involvedFromInput = Array.isArray(input.involved_user_ids)
    ? input.involved_user_ids.map((id) => asId(id))
    : [];
  // New projects always need Engineer II reviewers on involvedUserIds so they can
  // see pending reports, PDM, S-Curve, and Bar Chart for the project.
  if (!involvedFromInput.length) {
    try {
      const eng2 = await listUsersByRole('engineer_2');
      involvedFromInput = eng2.map((user) => asId(user.id));
    } catch {
      /* keep empty; UI should still prompt for reviewers */
    }
  }
  const projectAccess = buildProjectAccess({
    contractorId,
    assignedUserIds: uniqueUserIds([...(access ? [access.uid] : []), ...assignedFromInput]),
    involvedUserIds: involvedFromInput,
  });
  const ref = doc(collection(db, COLLECTIONS.projects));
  const payload = omitUndefined({
    name: input.name,
    location: input.location ?? null,
    startDate: toCalendarDate(input.start_date),
    plannedEndDate: toCalendarDate(input.planned_end_date),
    baselineMode: input.baseline_mode === 'prior_suspension' ? 'prior_suspension' : 'active',
    contactDetails: input.contact_details ?? null,
    revisedCompletionDate: toCalendarDate(input.revised_completion_date),
    suspensionStartDate: toCalendarDate(input.suspension_start_date),
    suspensionEndDate: toCalendarDate(input.suspension_end_date),
    status: input.status ?? 'active',
    lifecycleState: 'active' as LifecycleState,
    contractorId: projectAccess.contractorId,
    contractorName,
    assignedUserIds: projectAccess.assignedUserIds,
    involvedUserIds: projectAccess.involvedUserIds,
    accessUserIds: projectAccess.accessUserIds,
    contractAmount: input.contract_amount ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await setDoc(ref, payload);
  try {
    await syncUserProjectMembership(ref.id, projectAccess);
  } catch {
    /* membership pointers are best-effort; project accessUserIds still gate reads */
  }
  invalidateListCache('projects:');
  invalidateListCache('projectIds:');
  invalidateListCache('reports:');
  invalidateListCache('dashboard:');

  if (input.contract_amount != null) {
    await addDoc(collection(db, projectContractHistoryPath(ref.id)), {
      contractAmount: input.contract_amount,
      effectiveDate: input.start_date ?? nowIso().slice(0, 10),
      voReference: null,
      notes: 'Initial contract amount',
      createdAt: nowIso(),
      createdByName: actorName ?? null,
    });
  }

  return mapProject(ref.id, payload as Record<string, unknown>);
}

export async function updateProjectFs(id: string | number, input: ProjectInput, actorName?: string) {
  const projectId = asId(id);
  const ref = doc(db, COLLECTIONS.projects, projectId);
  const existing = await getDoc(ref);
  if (!existing.exists()) throw new Error('Project not found');
  const prev = existing.data() as Record<string, unknown>;
  if (lifecycleStateOf(prev) === 'archived') {
    throw new Error('Archived projects must be restored before editing.');
  }
  const prevAccess = readProjectAccess(prev);
  const contractorId =
    input.contractor_id !== undefined
      ? input.contractor_id != null
        ? asId(input.contractor_id)
        : null
      : (prev.contractorId as string | null) ?? null;
  const contractorName = await resolveContractorName(contractorId);
  const assignedUserIds =
    input.assigned_user_ids !== undefined
      ? uniqueUserIds(input.assigned_user_ids.map((id) => asId(id)))
      : prevAccess.assignedUserIds;
  const involvedUserIds =
    input.involved_user_ids !== undefined
      ? uniqueUserIds(input.involved_user_ids.map((id) => asId(id)))
      : prevAccess.involvedUserIds;
  const projectAccess = buildProjectAccess({
    contractorId,
    assignedUserIds,
    involvedUserIds,
  });

  const updates = omitUndefined({
    name: input.name ?? prev.name,
    location: input.location !== undefined ? input.location ?? null : prev.location,
    startDate:
      input.start_date !== undefined ? toCalendarDate(input.start_date) : toCalendarDate(prev.startDate),
    plannedEndDate:
      input.planned_end_date !== undefined
        ? toCalendarDate(input.planned_end_date)
        : toCalendarDate(prev.plannedEndDate),
    baselineMode:
      input.baseline_mode !== undefined
        ? input.baseline_mode === 'prior_suspension'
          ? 'prior_suspension'
          : 'active'
        : prev.baselineMode === 'prior_suspension'
          ? 'prior_suspension'
          : 'active',
    contactDetails:
      input.contact_details !== undefined ? input.contact_details ?? null : (prev.contactDetails ?? null),
    revisedCompletionDate:
      input.revised_completion_date !== undefined
        ? toCalendarDate(input.revised_completion_date)
        : toCalendarDate(prev.revisedCompletionDate),
    suspensionStartDate:
      input.suspension_start_date !== undefined
        ? toCalendarDate(input.suspension_start_date)
        : toCalendarDate(prev.suspensionStartDate),
    suspensionEndDate:
      input.suspension_end_date !== undefined
        ? toCalendarDate(input.suspension_end_date)
        : toCalendarDate(prev.suspensionEndDate),
    status: input.status ?? prev.status,
    contractorId: projectAccess.contractorId,
    contractorName,
    assignedUserIds: projectAccess.assignedUserIds,
    involvedUserIds: projectAccess.involvedUserIds,
    accessUserIds: projectAccess.accessUserIds,
    contractAmount:
      input.contract_amount !== undefined ? input.contract_amount ?? null : prev.contractAmount,
    updatedAt: nowIso(),
  });

  const auditFields: Array<[string, unknown, unknown]> = [
    ['name', prev.name, updates.name],
    ['location', prev.location, updates.location],
    ['status', prev.status, updates.status],
    ['contractorId', prev.contractorId, updates.contractorId],
    ['contractAmount', prev.contractAmount, updates.contractAmount],
    ['startDate', prev.startDate, updates.startDate],
    ['plannedEndDate', prev.plannedEndDate, updates.plannedEndDate],
    ['baselineMode', prev.baselineMode, updates.baselineMode],
    ['contactDetails', prev.contactDetails, updates.contactDetails],
    ['revisedCompletionDate', prev.revisedCompletionDate, updates.revisedCompletionDate],
    ['suspensionStartDate', prev.suspensionStartDate, updates.suspensionStartDate],
    ['suspensionEndDate', prev.suspensionEndDate, updates.suspensionEndDate],
    ['assignedUserIds', prevAccess.assignedUserIds.join(','), projectAccess.assignedUserIds.join(',')],
    ['involvedUserIds', prevAccess.involvedUserIds.join(','), projectAccess.involvedUserIds.join(',')],
  ];
  await updateDoc(ref, updates);

  for (const [field, oldVal, newVal] of auditFields) {
    if (String(oldVal ?? '') === String(newVal ?? '')) continue;
    try {
      await writeProjectAudit(projectId, field, oldVal, newVal, actorName);
    } catch {
      /* The project document is already updated. A failed audit entry must not undo it. */
    }
  }

  if (input.contract_amount != null && Number(prev.contractAmount ?? 0) !== Number(input.contract_amount)) {
    await addDoc(collection(db, projectContractHistoryPath(projectId)), {
      contractAmount: input.contract_amount,
      effectiveDate: nowIso().slice(0, 10),
      voReference: null,
      notes: 'Contract amount updated',
      createdAt: nowIso(),
      createdByName: actorName ?? null,
    });
  }

  try {
    await syncUserProjectMembership(projectId, projectAccess, prevAccess);
  } catch {
    /* membership pointers are best-effort; project accessUserIds still gate reads */
  }
  invalidateListCache('projects:');
  invalidateListCache('projectIds:');
  invalidateListCache('reports:');
  invalidateListCache('dashboard:');
  invalidateListCache(`chartContext:${projectId}`);
  invalidateListCache(`reportProgress:${projectId}`);
  invalidateListCache(`sCurveVersions:${projectId}`);
  return mapProject(projectId, { ...prev, ...updates });
}

async function archiveProjectRecord(
  projectId: string,
  archiveOwnerId: string,
  archiveOwnerRole: string,
  actorName?: string,
) {
  const ref = doc(db, COLLECTIONS.projects, projectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Project not found');
  const data = snap.data() as Record<string, unknown>;
  const access = readProjectAccess(data);
  const archivedAccessSnapshot = {
    contractorId: access.contractorId,
    assignedUserIds: access.assignedUserIds,
    involvedUserIds: access.involvedUserIds,
    accessUserIds: access.accessUserIds,
  };
  await updateDoc(ref, {
    lifecycleState: 'archived',
    archiveOwnerId,
    archiveOwnerRole,
    archivedAt: nowIso(),
    purgeAfter: futureIso(21),
    restoredAt: null,
    restoredBy: null,
    archivedAccessSnapshot,
    contractorId: null,
    assignedUserIds: uniqueUserIds([archiveOwnerId]),
    involvedUserIds: [],
    accessUserIds: uniqueUserIds([archiveOwnerId]),
    updatedAt: nowIso(),
  });
  await writeProjectAudit(projectId, 'lifecycleState', lifecycleStateOf(data), 'archived', actorName);
  await queueProjectEmail(projectId, 'project_archived', {
    archiveOwnerId,
    archiveOwnerRole,
    projectName: data.name ?? null,
  });
  invalidateListCache('projects:');
  invalidateListCache('projectIds:');
  invalidateListCache('reports:');
  invalidateListCache('dashboard:');
}

export async function requestProjectArchiveFs(id: string | number, actorName?: string) {
  const access = await getAccessContext();
  if (!access || access.role !== 'engineer_1') {
    throw new Error('Only Engineer I can request project deletion approval.');
  }
  const projectId = asId(id);
  const ref = doc(db, COLLECTIONS.projects, projectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Project not found');
  const data = snap.data() as Record<string, unknown>;
  if (lifecycleStateOf(data) === 'archived') throw new Error('Project is already archived.');
  await updateDoc(ref, {
    lifecycleState: 'pending_delete_approval',
    deletionApproval: {
      requestedBy: access.uid,
      requestedRole: access.role,
      requestedAt: nowIso(),
      engineer2: null,
      engineer3: null,
      engineer4: null,
      completedAt: null,
    },
    updatedAt: nowIso(),
  });
  await writeProjectAudit(projectId, 'lifecycleState', lifecycleStateOf(data), 'pending_delete_approval', actorName);
  await queueProjectEmail(projectId, 'project_archive_requested', { requestedBy: access.uid });
  const updated = await getDoc(ref);
  return mapProject(updated.id, updated.data() as Record<string, unknown>);
}

export async function approveProjectArchiveFs(id: string | number, actorName?: string) {
  const access = await getAccessContext();
  if (!access || !['engineer_2', 'engineer_3', 'engineer_4'].includes(access.role)) {
    throw new Error('Only Engineer II, III, or IV can approve project deletion.');
  }
  const projectId = asId(id);
  const ref = doc(db, COLLECTIONS.projects, projectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Project not found');
  const data = snap.data() as Record<string, unknown>;
  if (lifecycleStateOf(data) !== 'pending_delete_approval') {
    throw new Error('Project is not waiting for deletion approval.');
  }
  const deletionApproval =
    ((data.deletionApproval as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const approvalKey =
    access.role === 'engineer_2'
      ? 'engineer2'
      : access.role === 'engineer_3'
        ? 'engineer3'
        : 'engineer4';
  const nextDeletionApproval = {
    ...deletionApproval,
    [approvalKey]: {
      approvedBy: access.uid,
      approvedRole: access.role,
      approvedAt: nowIso(),
    },
  };
  await updateDoc(ref, {
    deletionApproval: nextDeletionApproval,
    updatedAt: nowIso(),
  });
  await writeProjectAudit(projectId, approvalKey, 'pending', 'approved', actorName);

  if (nextDeletionApproval.engineer2 && nextDeletionApproval.engineer3 && nextDeletionApproval.engineer4) {
    const ownerId =
      deletionApproval.requestedBy != null ? asId(String(deletionApproval.requestedBy)) : access.uid;
    const ownerRole = String(deletionApproval.requestedRole ?? 'engineer_1');
    await archiveProjectRecord(projectId, ownerId, ownerRole, actorName);
  } else {
    await queueProjectEmail(projectId, 'project_archive_approved', {
      approvalRole: access.role,
      approvalUserId: access.uid,
    });
  }

  const updated = await getDoc(ref);
  return mapProject(updated.id, updated.data() as Record<string, unknown>);
}

export async function directArchiveProjectFs(id: string | number, actorName?: string) {
  const access = await getAccessContext();
  if (!access || access.role !== 'engineer_4') {
    throw new Error('Only Engineer IV can directly archive a project.');
  }
  const projectId = asId(id);
  await archiveProjectRecord(projectId, access.uid, access.role, actorName);
  const updated = await getDoc(doc(db, COLLECTIONS.projects, projectId));
  return mapProject(updated.id, updated.data() as Record<string, unknown>);
}

export async function restoreArchivedProjectFs(id: string | number, actorName?: string) {
  const access = await getAccessContext();
  if (!access) throw new Error('Not signed in.');
  const projectId = asId(id);
  const ref = doc(db, COLLECTIONS.projects, projectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Project not found');
  const data = snap.data() as Record<string, unknown>;
  if (lifecycleStateOf(data) !== 'archived') throw new Error('Project is not archived.');
  if (String(data.archiveOwnerId ?? '') !== access.uid && access.role !== 'engineer_4') {
    throw new Error('Only the archive owner or Engineer IV can restore this project.');
  }
  const snapshot =
    ((data.archivedAccessSnapshot as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const restoredContractorId =
    snapshot.contractorId != null ? asId(String(snapshot.contractorId)) : null;
  const restoredContractorName = await resolveContractorName(restoredContractorId);
  const restoredAccess = buildProjectAccess({
    contractorId: restoredContractorId,
    assignedUserIds: snapshot.assignedUserIds,
    involvedUserIds: snapshot.involvedUserIds,
  });
  await updateDoc(ref, {
    lifecycleState: 'active',
    archiveOwnerId: null,
    archiveOwnerRole: null,
    archivedAt: null,
    purgeAfter: null,
    restoredAt: nowIso(),
    restoredBy: access.uid,
    deletionApproval: null,
    archivedAccessSnapshot: null,
    contractorId: restoredAccess.contractorId,
    contractorName: restoredContractorName ?? data.contractorName ?? null,
    assignedUserIds: restoredAccess.assignedUserIds,
    involvedUserIds: restoredAccess.involvedUserIds,
    accessUserIds: restoredAccess.accessUserIds,
    updatedAt: nowIso(),
  });
  await writeProjectAudit(projectId, 'lifecycleState', 'archived', 'active', actorName);
  await queueProjectEmail(projectId, 'project_restored', {
    restoredBy: access.uid,
    restoredRole: access.role,
  });
  invalidateListCache('projects:');
  invalidateListCache('projectIds:');
  invalidateListCache('reports:');
  invalidateListCache('dashboard:');
  const updated = await getDoc(ref);
  return mapProject(updated.id, updated.data() as Record<string, unknown>);
}
