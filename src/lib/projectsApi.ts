import {
  approveProjectArchiveFs,
  createProjectFs,
  directArchiveProjectFs,
  getProjectFs,
  listContractorsFs,
  listProjectsFs,
  requestProjectArchiveFs,
  restoreArchivedProjectFs,
  updateProjectFs,
} from './firebase/projects';

export interface ProjectRow {
  id: string;
  name: string;
  location: string | null;
  status: string;
  lifecycle_state?: 'active' | 'pending_delete_approval' | 'archived';
  archive_owner_id?: string | null;
  archive_owner_role?: string | null;
  archived_at?: string | null;
  purge_after?: string | null;
  deletion_approval?: Record<string, unknown> | null;
  start_date?: string | null;
  planned_end_date?: string | null;
  contractor_id?: string | null;
  contractor_name?: string | null;
  contract_amount?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ContractorOption {
  id: string;
  full_name: string;
  email: string;
}

export interface ProjectAuditEntry {
  id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  actor_name?: string | null;
}

export interface ContractHistoryEntry {
  id: string;
  contract_amount: number;
  effective_date: string;
  vo_reference: string | null;
  notes: string | null;
  created_at: string;
  created_by_name?: string | null;
}

export interface ProjectReportDefaults {
  contractor: string;
  start_date: string | null;
  contract_amount: string | null;
  project_name: string;
  location: string | null;
}

export interface ProjectInput {
  name: string;
  location?: string;
  start_date?: string;
  planned_end_date?: string;
  status?: string;
  contractor_id?: string | null;
  contract_amount?: number | null;
}

export interface ProjectListOptions {
  view?: 'active' | 'archived' | 'all';
}

export async function listProjects(options?: ProjectListOptions) {
  const projects = await listProjectsFs(options);
  return { projects };
}

export async function listContractors() {
  const contractors = await listContractorsFs();
  return { contractors };
}

export async function getProject(id: string | number) {
  return getProjectFs(id);
}

export async function createProject(input: ProjectInput) {
  const project = await createProjectFs(input);
  return { project };
}

export async function updateProject(id: string | number, input: ProjectInput) {
  const project = await updateProjectFs(id, input);
  return { project };
}

export async function requestProjectArchive(id: string | number) {
  const project = await requestProjectArchiveFs(id);
  return { project };
}

export async function approveProjectArchive(id: string | number) {
  const project = await approveProjectArchiveFs(id);
  return { project };
}

export async function directArchiveProject(id: string | number) {
  const project = await directArchiveProjectFs(id);
  return { project };
}

export async function restoreArchivedProject(id: string | number) {
  const project = await restoreArchivedProjectFs(id);
  return { project };
}
