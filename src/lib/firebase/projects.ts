import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  addDoc,
} from 'firebase/firestore';
import { COLLECTIONS, projectAuditPath, projectContractHistoryPath } from './collections';
import { db } from './config';
import { asId, nowIso, omitUndefined } from './ids';
import type {
  ContractHistoryEntry,
  ContractorOption,
  ProjectAuditEntry,
  ProjectInput,
  ProjectReportDefaults,
  ProjectRow,
} from '../projectsApi';

function mapProject(id: string, data: Record<string, unknown>): ProjectRow {
  return {
    id,
    name: String(data.name ?? ''),
    location: (data.location as string | null) ?? null,
    status: String(data.status ?? 'active'),
    start_date: (data.startDate as string | null) ?? null,
    planned_end_date: (data.plannedEndDate as string | null) ?? null,
    contractor_id: data.contractorId != null ? asId(data.contractorId as string) : null,
    contractor_name: (data.contractorName as string | null) ?? null,
    contract_amount:
      data.contractAmount != null ? Number(data.contractAmount) : null,
    created_at: (data.createdAt as string | null) ?? null,
    updated_at: (data.updatedAt as string | null) ?? null,
  };
}

export async function listProjectsFs(): Promise<ProjectRow[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.projects));
  const rows = snap.docs.map((d) => mapProject(d.id, d.data() as Record<string, unknown>));
  rows.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
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

async function resolveContractorName(contractorId: string | null | undefined) {
  if (!contractorId) return null;
  const snap = await getDoc(doc(db, COLLECTIONS.users, contractorId));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  return String(data.fullName ?? data.name ?? '');
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
  const contractorId = input.contractor_id != null ? asId(input.contractor_id) : null;
  const contractorName = await resolveContractorName(contractorId);
  const ref = doc(collection(db, COLLECTIONS.projects));
  const payload = omitUndefined({
    name: input.name,
    location: input.location ?? null,
    startDate: input.start_date ?? null,
    plannedEndDate: input.planned_end_date ?? null,
    status: input.status ?? 'active',
    contractorId,
    contractorName,
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

export async function updateProjectFs(
  id: string | number,
  input: ProjectInput,
  actorName?: string,
) {
  const projectId = asId(id);
  const ref = doc(db, COLLECTIONS.projects, projectId);
  const existing = await getDoc(ref);
  if (!existing.exists()) throw new Error('Project not found');
  const prev = existing.data() as Record<string, unknown>;
  const contractorId =
    input.contractor_id !== undefined
      ? input.contractor_id != null
        ? asId(input.contractor_id)
        : null
      : (prev.contractorId as string | null) ?? null;
  const contractorName = await resolveContractorName(contractorId);

  const updates = omitUndefined({
    name: input.name ?? prev.name,
    location: input.location !== undefined ? input.location ?? null : prev.location,
    startDate: input.start_date !== undefined ? input.start_date ?? null : prev.startDate,
    plannedEndDate:
      input.planned_end_date !== undefined
        ? input.planned_end_date ?? null
        : prev.plannedEndDate,
    status: input.status ?? prev.status,
    contractorId,
    contractorName,
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
    await addDoc(collection(db, projectAuditPath(projectId)), {
      fieldName: field,
      oldValue: oldVal != null ? String(oldVal) : null,
      newValue: newVal != null ? String(newVal) : null,
      createdAt: nowIso(),
      actorName: actorName ?? null,
    });
  }

  if (
    input.contract_amount != null &&
    Number(prev.contractAmount ?? 0) !== Number(input.contract_amount)
  ) {
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
