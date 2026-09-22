import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { COLLECTIONS, projectAuditPath, projectContractHistoryPath } from './collections';
import { buildProjectAccess, getAccessContext, readProjectAccess, uniqueUserIds } from './access';
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
    start_date: (data.startDate as string | null) ?? null,
    planned_end_date: (data.plannedEndDate as string | null) ?? null,
    contractor_id: data.contractorId != null ? asId(data.contractorId as string) : null,
    contractor_name: (data.contractorName as string | null) ?? null,
    contract_amount: data.contractAmount != null ? Number(data.contractAmount) : null,
    created_at: (data.createdAt as string | null) ?? null,
    updated_at: (data.updatedAt as string | null) ?? null,
  };
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
  const source = access.hasGlobalProjectAccess
    ? collection(db, COLLECTIONS.projects)
    : query(collection(db, COLLECTIONS.projects), where('accessUserIds', 'array-contains', access.uid));
  const snap = await getDocs(source);
  const rows = snap.docs
    .map((d) => mapProject(d.id, d.data() as Record<string, unknown>))
    .filter((row) => matchesProjectView(row, options?.view ?? 'active'));
  rows.sort((a, b) => (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? ''));
  return rows;
}

export async function listContractorsFs(): Promise<ContractorOption[]> {
  const q = query(collection(db, COLLECTIONS.users), where('role', '==', 'contractor'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      full_name: String(data.fullName ?? data.name ?? ''),
      email: String(data.email ?? ''),
    };
  });
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
  const projectAccess = buildProjectAccess({
    contractorId,
    assignedUserIds: access ? [access.uid] : [],
  });
  const ref = doc(collection(db, COLLECTIONS.projects));
  const payload = omitUndefined({
    name: input.name,
    location: input.location ?? null,
    startDate: input.start_date ?? null,
    plannedEndDate: input.planned_end_date ?? null,
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
  const projectAccess = buildProjectAccess({
    contractorId,
    assignedUserIds: prevAccess.assignedUserIds,
    involvedUserIds: prevAccess.involvedUserIds,
  });

  const updates = omitUndefined({
    name: input.name ?? prev.name,
    location: input.location !== undefined ? input.location ?? null : prev.location,
    startDate: input.start_date !== undefined ? input.start_date ?? null : prev.startDate,
    plannedEndDate:
      input.planned_end_date !== undefined ? input.planned_end_date ?? null : prev.plannedEndDate,
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
  ];
  for (const [field, oldVal, newVal] of auditFields) {
    if (String(oldVal ?? '') === String(newVal ?? '')) continue;
    await writeProjectAudit(projectId, field, oldVal, newVal, actorName);
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

  await updateDoc(ref, updates);
  const snap = await getDoc(ref);
  return mapProject(snap.id, snap.data() as Record<string, unknown>);
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
  const updated = await getDoc(ref);
  return mapProject(updated.id, updated.data() as Record<string, unknown>);
}
