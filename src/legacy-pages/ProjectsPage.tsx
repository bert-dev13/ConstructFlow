'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { usePagination } from '../hooks/usePagination';
import {
  createProject,
  directArchiveProject,
  getProject,
  listContractors,
  listEngineerOnes,
  listEngineerTwos,
  listProjects,
  requestProjectArchive,
  restoreArchivedProject,
  updateProject,
  type ContractorOption,
  type ProjectAuditEntry,
  type ProjectRow,
  type ContractHistoryEntry,
} from '../lib/projectsApi';

function dateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function formatMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: string): string {
  if (status === 'completed') return 'border-sky-200 bg-sky-50 text-sky-700';
  if (status === 'on_hold') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

type HealthFilter = 'all' | 'on_track' | 'delayed' | 'on_hold' | 'completed';
type SortBy = 'recent' | 'name' | 'value' | 'start';

function scheduleHealth(project: ProjectRow): {
  key: Exclude<HealthFilter, 'all'>;
  label: string;
  className: string;
} {
  if (project.status === 'completed') {
    return { key: 'completed', label: 'Completed', className: 'text-sky-700' };
  }
  if (project.status === 'on_hold') {
    return { key: 'on_hold', label: 'On hold', className: 'text-amber-700' };
  }
  if (project.planned_end_date && new Date(project.planned_end_date) < new Date()) {
    return { key: 'delayed', label: 'Past planned end', className: 'text-red-600' };
  }
  return { key: 'on_track', label: 'On track', className: 'text-emerald-700' };
}

function lifecycleBadgeClass(project: ProjectRow): string {
  if (project.lifecycle_state === 'archived') {
    return 'border-slate-200 bg-slate-50 text-slate-600';
  }
  if (project.lifecycle_state === 'pending_delete_approval') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return statusClass(project.status);
}

export function ProjectsPage() {
  const { user } = useAuth();
  const { setProjectId } = useSelectedProject();
  const canManage = user?.role === 'engineer_1' || user?.role === 'engineer_4';
  const canRequestArchive = user?.role === 'engineer_1';
  const canDirectArchive = user?.role === 'engineer_4';

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<ProjectRow[]>([]);
  const [contractors, setContractors] = useState<ContractorOption[]>([]);
  const [engineerOnes, setEngineerOnes] = useState<ContractorOption[]>([]);
  const [engineerTwos, setEngineerTwos] = useState<ContractorOption[]>([]);
  const [auditLog, setAuditLog] = useState<ProjectAuditEntry[]>([]);
  const [contractHistory, setContractHistory] = useState<ContractHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [contractorFilter, setContractorFilter] = useState('all');
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [projectView, setProjectView] = useState<'active' | 'archived'>('active');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [involvedUserIds, setInvolvedUserIds] = useState<string[]>([]);
  const [contractAmount, setContractAmount] = useState('');
  const [status, setStatus] = useState('active');

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setLocation('');
    setStartDate('');
    setPlannedEnd('');
    setContractorId('');
    setAssignedUserIds(user?.id ? [String(user.id)] : []);
    setInvolvedUserIds([]);
    setContractAmount('');
    setStatus('active');
    setAuditLog([]);
    setContractHistory([]);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    resetForm();
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // One fetch for all accessible projects, then split client-side.
      const allRes = await listProjects({ view: 'all' });
      const active = allRes.projects.filter((p) => p.lifecycle_state !== 'archived');
      const archived = allRes.projects.filter((p) => p.lifecycle_state === 'archived');
      setProjects(active);
      setArchivedProjects(archived);
    } catch {
      setProjects([]);
      setArchivedProjects([]);
      setError('Could not load projects from database.');
    } finally {
      setLoading(false);
    }

    try {
      const [contractorRes, eng1Res, eng2Res] = await Promise.all([
        listContractors(),
        listEngineerOnes(),
        listEngineerTwos(),
      ]);
      setContractors(contractorRes.contractors);
      setEngineerOnes(eng1Res.engineers);
      setEngineerTwos(eng2Res.engineers);
    } catch {
      setContractors([]);
      setEngineerOnes([]);
      setEngineerTwos([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startRevise = async (p: ProjectRow) => {
    setError('');
    setSuccess('');
    setEditingId(p.id);
    setName(p.name);
    setLocation(p.location ?? '');
    setStartDate(dateInputValue(p.start_date));
    setPlannedEnd(dateInputValue(p.planned_end_date));
    setContractorId(p.contractor_id != null ? String(p.contractor_id) : '');
    setAssignedUserIds((p.assigned_user_ids ?? []).map(String).filter((id) => id !== String(p.contractor_id ?? '')));
    setInvolvedUserIds((p.involved_user_ids ?? []).map(String));
    setContractAmount(p.contract_amount != null ? String(p.contract_amount) : '');
    setStatus(p.status || 'active');
    setDrawerOpen(true);
    try {
      const detail = await getProject(p.id);
      setAuditLog(detail.audit_log);
      setContractHistory(detail.contract_history);
    } catch {
      setAuditLog([]);
      setContractHistory([]);
    }
  };

  const toggleId = (list: string[], id: string, checked: boolean) =>
    checked ? [...new Set([...list, id])] : list.filter((value) => value !== id);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!name.trim()) {
      setError('Project title is required.');
      return;
    }
    setSaving(true);
    try {
      const creatorId = user?.id ? String(user.id) : null;
      const nextAssigned = [...new Set([...(creatorId ? [creatorId] : []), ...assignedUserIds])];
      const input = {
        name: name.trim(),
        location: location.trim() || undefined,
        start_date: startDate || undefined,
        planned_end_date: plannedEnd || undefined,
        status: status || 'active',
        contractor_id: contractorId || null,
        contract_amount: contractAmount ? parseFloat(contractAmount) : null,
        assigned_user_ids: nextAssigned,
        involved_user_ids: involvedUserIds,
      };

      if (editingId !== null) {
        const res = await updateProject(editingId, input);
        setSuccess(`Project "${res.project.name}" updated.`);
        setProjectId(String(res.project.id));
        const detail = await getProject(editingId);
        setAuditLog(detail.audit_log);
        setContractHistory(detail.contract_history);
      } else {
        const res = await createProject(input);
        setSuccess(
          `Project "${res.project.name}" created. The contractor can now prepare its schedule.`,
        );
        setProjectId(String(res.project.id));
        resetForm();
      }
      await load();
      setDrawerOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : editingId !== null
            ? 'Could not update project.'
            : 'Could not create project.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRequestArchive = async (project: ProjectRow) => {
    setArchiveBusyId(project.id);
    setError('');
    setSuccess('');
    try {
      await requestProjectArchive(project.id);
      setSuccess(`Deletion approval requested for "${project.name}".`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request deletion approval.');
    } finally {
      setArchiveBusyId(null);
    }
  };

  const handleDirectArchive = async (project: ProjectRow) => {
    setArchiveBusyId(project.id);
    setError('');
    setSuccess('');
    try {
      await directArchiveProject(project.id);
      setSuccess(`"${project.name}" moved to archive for 21 days.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive project.');
    } finally {
      setArchiveBusyId(null);
    }
  };

  const handleRestoreArchive = async (project: ProjectRow) => {
    setArchiveBusyId(project.id);
    setError('');
    setSuccess('');
    try {
      await restoreArchivedProject(project.id);
      setSuccess(`"${project.name}" restored to active projects.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore project.');
    } finally {
      setArchiveBusyId(null);
    }
  };

  const openCreate = () => {
    resetForm();
    setError('');
    setSuccess('');
    setDrawerOpen(true);
  };

  const contractorOptions = useMemo(() => {
    // Only active contractor accounts from listContractors — do not resurrect
    // legacy/orphan contractor ids that may still appear on old project docs.
    return contractors
      .map((contractor) => ({ id: contractor.id, name: contractor.full_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [contractors]);

  const hasActiveFilters =
    Boolean(query.trim()) ||
    statusFilter !== 'all' ||
    healthFilter !== 'all' ||
    contractorFilter !== 'all' ||
    sortBy !== 'recent';

  const clearFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setHealthFilter('all');
    setContractorFilter('all');
    setSortBy('recent');
  };

  const filteredProjects = useMemo(() => {
    const source = projectView === 'archived' ? archivedProjects : projects;
    const normalizedQuery = query.trim().toLowerCase();
    const result = source.filter((project) => {
      const matchesQuery =
        !normalizedQuery ||
        [project.name, project.location, project.contractor_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      const matchesStatus =
        projectView === 'archived' || statusFilter === 'all' || project.status === statusFilter;
      const health = scheduleHealth(project);
      const matchesHealth = healthFilter === 'all' || health.key === healthFilter;
      const matchesContractor =
        contractorFilter === 'all' ||
        String(project.contractor_id ?? '') === contractorFilter ||
        (contractorFilter === 'unassigned' && !project.contractor_id);
      return matchesQuery && matchesStatus && matchesHealth && matchesContractor;
    });

    return result.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'value') return (b.contract_amount ?? 0) - (a.contract_amount ?? 0);
      if (sortBy === 'start') return (a.start_date ?? '').localeCompare(b.start_date ?? '');
      return (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? '');
    });
  }, [
    archivedProjects,
    contractorFilter,
    healthFilter,
    projectView,
    projects,
    query,
    sortBy,
    statusFilter,
  ]);

  const activeCount = projects.filter((project) => project.status === 'active').length;
  const completedCount = projects.filter((project) => project.status === 'completed').length;
  const delayedCount = projects.filter((project) => scheduleHealth(project).key === 'delayed').length;
  const pendingDeleteCount = projects.filter(
    (project) => project.lifecycle_state === 'pending_delete_approval',
  ).length;
  const archivedCount = archivedProjects.length;
  const sourceTotal = projectView === 'archived' ? archivedProjects.length : projects.length;

  const {
    page,
    setPage,
    pageItems,
    totalPages,
    from,
    to,
    total,
    pageSize,
  } = usePagination(filteredProjects, {
    resetKey: `${projectView}|${query}|${statusFilter}|${healthFilter}|${contractorFilter}|${sortBy}`,
  });

  const inputCls =
    'mt-1.5 w-full rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm text-text shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
  const filterControlCls =
    'w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60';

  const portfolioTabs: { id: 'active' | 'archived'; label: string; count: number }[] = [
    { id: 'active', label: 'Active & pending', count: projects.length },
    { id: 'archived', label: 'Archived', count: archivedCount },
  ];

  return (
    <main className="min-h-screen flex-1 overflow-y-auto bg-surface">
      <div className="space-y-5 px-8 pb-10 pt-6">
        <PageHeader
          badge={user?.role === 'engineer_4' ? 'Engineer IV · Archive' : 'Engineer I · Portfolio'}
          title="Projects"
          description={
            user?.role === 'engineer_4'
              ? 'Archive, restore, and monitor project lifecycle alongside project details.'
              : 'Keep project information, contract details, and delivery status in one place.'
          }
          actions={
            canManage ? (
              <button
                type="button"
                onClick={openCreate}
                className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-primary/90"
              >
                + New project
              </button>
            ) : undefined
          }
        />

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-primary/20 bg-primary-light px-4 py-3 text-sm text-primary">
            {success}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(
            [
              {
                label: 'Total projects',
                value: projects.length,
                caption: 'Registered in portfolio',
                icon: 'projects' as NavIconName,
                onClick: () => {
                  setProjectView('active');
                  clearFilters();
                },
              },
              {
                label: 'Active',
                value: activeCount,
                caption: 'Currently in delivery',
                icon: 'schedule' as NavIconName,
                onClick: () => {
                  setProjectView('active');
                  setStatusFilter('active');
                  setHealthFilter('all');
                },
              },
              {
                label: 'Delayed',
                value: delayedCount,
                caption: 'Past planned end date',
                icon: 'approval' as NavIconName,
                onClick: () => {
                  setProjectView('active');
                  setHealthFilter('delayed');
                  setStatusFilter('all');
                },
              },
              {
                label: 'Archived',
                value: archivedCount,
                caption:
                  pendingDeleteCount > 0
                    ? `${pendingDeleteCount} pending archive approval`
                    : 'Recoverable for 21 days',
                icon: 'reports' as NavIconName,
                onClick: () => {
                  setProjectView('archived');
                  clearFilters();
                },
              },
            ] as const
          ).map((card) => (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary/30 hover:bg-primary-light/30"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {card.label}
                </p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                  <NavIcon name={card.icon} className="h-5 w-5" />
                </span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-text">{card.value}</p>
              <p className="mt-1 text-xs text-text-muted">{card.caption}</p>
            </button>
          ))}
        </div>

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border bg-surface-muted/40 px-4 pt-3">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Project sections">
              {portfolioTabs.map((tab) => {
                const active = projectView === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setProjectView(tab.id)}
                    className={`-mb-px inline-flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition ${
                      active
                        ? 'border border-b-0 border-border bg-card text-primary'
                        : 'text-text-muted hover:bg-card/60 hover:text-text'
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        active ? 'bg-primary text-white' : 'bg-surface-muted text-text-muted'
                      }`}
                    >
                      {loading ? '…' : tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-b border-border bg-card px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Filters</p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-text-muted hover:bg-surface-muted"
                >
                  Clear filters
                </button>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <label className="block min-w-0 sm:col-span-2 xl:col-span-1">
                <span className="sr-only">Search</span>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted">
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search project, location, contractor…"
                    className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </label>

              <label className="block min-w-0">
                <span className="sr-only">Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  disabled={projectView === 'archived'}
                  className={filterControlCls}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                </select>
              </label>

              <label className="block min-w-0">
                <span className="sr-only">Schedule health</span>
                <select
                  value={healthFilter}
                  onChange={(e) => setHealthFilter(e.target.value as HealthFilter)}
                  disabled={projectView === 'archived'}
                  className={filterControlCls}
                >
                  <option value="all">All schedules</option>
                  <option value="on_track">On track</option>
                  <option value="delayed">Past planned end</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                </select>
              </label>

              <label className="block min-w-0">
                <span className="sr-only">Contractor</span>
                <select
                  value={contractorFilter}
                  onChange={(e) => setContractorFilter(e.target.value)}
                  className={filterControlCls}
                >
                  <option value="all">All contractors</option>
                  <option value="unassigned">Unassigned</option>
                  {contractorOptions.map((contractor) => (
                    <option key={contractor.id} value={contractor.id}>
                      {contractor.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block min-w-0">
                <span className="sr-only">Sort</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className={filterControlCls}
                >
                  <option value="recent">Recently updated</option>
                  <option value="name">Project name</option>
                  <option value="value">Contract value</option>
                  <option value="start">Start date</option>
                </select>
              </label>
            </div>

            {hasActiveFilters && (
              <p className="mt-2 text-[11px] text-text-muted">
                Showing filtered results
                {statusFilter !== 'all' ? ` · ${statusLabel(statusFilter)}` : ''}
                {healthFilter !== 'all'
                  ? ` · ${
                      healthFilter === 'delayed'
                        ? 'Past planned end'
                        : statusLabel(healthFilter)
                    }`
                  : ''}
                {contractorFilter !== 'all'
                  ? ` · ${
                      contractorFilter === 'unassigned'
                        ? 'Unassigned'
                        : contractorOptions.find((c) => c.id === contractorFilter)?.name ??
                          'Contractor'
                    }`
                  : ''}
                {query.trim() ? ` · “${query.trim()}”` : ''}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-text">
                {projectView === 'archived' ? 'Archived projects' : 'Project portfolio'}
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                {loading
                  ? 'Loading projects…'
                  : `${filteredProjects.length} of ${sourceTotal} projects`}
                {projectView === 'active' && completedCount > 0
                  ? ` · ${completedCount} completed`
                  : ''}
              </p>
            </div>
          </div>

          <div className="p-4" role="tabpanel">
            {loading ? (
              <div className="h-40 animate-pulse rounded-xl bg-surface-muted/60" />
            ) : filteredProjects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-surface/40 px-6 py-14 text-center">
                <p className="font-semibold text-text">
                  {projectView === 'archived'
                    ? 'No archived projects'
                    : projects.length
                      ? 'No matching projects'
                      : 'No projects yet'}
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  {projectView === 'archived'
                    ? 'Archived projects still within the 21-day recovery window will appear here.'
                    : projects.length
                      ? 'Try a different search term or clear the filters.'
                      : 'Create your first project to begin tracking delivery.'}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text-muted hover:bg-surface-muted"
                    >
                      Clear filters
                    </button>
                  )}
                  {!projects.length && canManage && (
                    <button
                      type="button"
                      onClick={openCreate}
                      className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white"
                    >
                      Create first project
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                  <thead className="bg-surface-muted/60">
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                      <th className="px-4 py-3 font-semibold">Project</th>
                      <th className="px-4 py-3 font-semibold">Contractor</th>
                      <th className="px-4 py-3 font-semibold">Contract value</th>
                      <th className="px-4 py-3 font-semibold">Schedule</th>
                      <th className="px-4 py-3 font-semibold">Timeline</th>
                      <th className="px-4 py-3 font-semibold">State</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/80 bg-card">
                    {pageItems.map((p) => {
                      const health = scheduleHealth(p);
                      const lifecycleLabel =
                        p.lifecycle_state === 'archived'
                          ? 'Archived'
                          : p.lifecycle_state === 'pending_delete_approval'
                            ? 'Pending archive'
                            : statusLabel(p.status);
                      return (
                        <tr key={p.id} className="transition hover:bg-surface-muted/40">
                          <td className="px-4 py-3.5">
                            <p className="font-semibold text-text">{p.name}</p>
                            <p className="mt-0.5 text-xs text-text-muted">
                              {p.location || 'Location not set'}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 text-text">
                            {p.contractor_name || (
                              <span className="text-text-muted">Not assigned</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-medium text-text">
                            {p.contract_amount != null
                              ? `₱${formatMoney(p.contract_amount)}`
                              : <span className="font-normal text-text-muted">Not set</span>}
                          </td>
                          <td className={`px-4 py-3.5 font-medium ${health.className}`}>
                            {health.label}
                          </td>
                          <td className="px-4 py-3.5 text-text-muted">
                            <p>
                              {dateInputValue(p.start_date) || '—'} →{' '}
                              {dateInputValue(p.planned_end_date) || '—'}
                            </p>
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${lifecycleBadgeClass(p)}`}
                            >
                              {lifecycleLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex flex-wrap justify-end gap-1.5">
                              {projectView === 'active' && (
                                <button
                                  type="button"
                                  onClick={() => setProjectId(String(p.id))}
                                  className="rounded-lg bg-primary-light px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary-light/70"
                                >
                                  Select
                                </button>
                              )}
                              {projectView === 'active' && canManage && (
                                <Link
                                  to={`/projects/${p.id}/boq`}
                                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:bg-surface-muted"
                                >
                                  Pay items
                                </Link>
                              )}
                              {projectView === 'active' && canManage && (
                                <button
                                  type="button"
                                  onClick={() => startRevise(p)}
                                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:bg-surface-muted"
                                >
                                  Edit
                                </button>
                              )}
                              {projectView === 'active' &&
                                canRequestArchive &&
                                p.lifecycle_state !== 'pending_delete_approval' && (
                                  <button
                                    type="button"
                                    disabled={archiveBusyId === p.id}
                                    onClick={() => handleRequestArchive(p)}
                                    className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                  >
                                    {archiveBusyId === p.id ? 'Requesting…' : 'Request archive'}
                                  </button>
                                )}
                              {projectView === 'active' &&
                                canRequestArchive &&
                                p.lifecycle_state === 'pending_delete_approval' && (
                                  <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700">
                                    Awaiting E2/E3/E4
                                  </span>
                                )}
                              {projectView === 'active' && canDirectArchive && (
                                <button
                                  type="button"
                                  disabled={archiveBusyId === p.id}
                                  onClick={() => handleDirectArchive(p)}
                                  className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                                >
                                  {archiveBusyId === p.id ? 'Archiving…' : 'Archive'}
                                </button>
                              )}
                              {projectView === 'archived' && (
                                <button
                                  type="button"
                                  disabled={archiveBusyId === p.id}
                                  onClick={() => handleRestoreArchive(p)}
                                  className="rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                                >
                                  {archiveBusyId === p.id ? 'Restoring…' : 'Restore'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  from={from}
                  to={to}
                  pageSize={pageSize}
                  onPageChange={setPage}
                />
              </div>
            )}
          </div>
        </section>
      </div>

      {drawerOpen && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4" role="dialog" aria-modal="true" aria-labelledby="project-form-title">
          <button type="button" aria-label="Close project form" onClick={closeDrawer} className="absolute inset-0 cursor-default" />
          <form onSubmit={handleSubmit} className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card px-6 py-5">
              <div><p className="text-xs font-bold uppercase tracking-wider text-primary">{editingId !== null ? 'Project settings' : 'Portfolio'}</p><h2 id="project-form-title" className="mt-1 text-xl font-semibold text-text">{editingId !== null ? 'Edit project' : 'Create project'}</h2><p className="mt-1 text-sm text-text-muted">Keep the project record complete and current.</p></div>
              <button type="button" onClick={closeDrawer} className="rounded-lg p-2 text-xl text-text-muted hover:bg-surface-muted" aria-label="Close">×</button>
            </div>
            <div className="flex-1 space-y-5 px-6 py-6">
              <div>
                <h3 className="text-sm font-semibold text-text">Basic information</h3>
                <div className="mt-3 space-y-4">
                  <div><label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">Project title <span className="text-red-500">*</span></label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Concreting of Barangay Road" className={inputCls} required /></div>
                  <div><label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">Location</label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Remebella, Buguey, Cagayan" className={inputCls} /></div>
                </div>
              </div>
              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-semibold text-text">Contract details</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Contractor
                    </label>
                    <select
                      value={contractorId}
                      onChange={(e) => setContractorId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">— Select contractor —</option>
                      {contractors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                          {c.email ? ` (${c.email})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div><label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">Contract amount (₱)</label><input type="number" step="0.01" min="0" value={contractAmount} onChange={(e) => setContractAmount(e.target.value)} placeholder="5991119.01" className={inputCls} /></div>
                  <div><label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">Start date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></div>
                  <div><label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">Planned end date</label><input type="date" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} className={inputCls} /></div>
                </div>
              </div>
              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-semibold text-text">Project access</h3>
                <p className="mt-1 text-xs text-text-muted">
                  Engineer I / II only see projects they are assigned or involved in. Engineer III / IV keep access to all projects.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Engineer I (assigned)</p>
                    <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
                      {engineerOnes.length === 0 ? (
                        <p className="text-xs text-text-muted">No Engineer I accounts found.</p>
                      ) : (
                        engineerOnes.map((eng) => {
                          const checked = assignedUserIds.includes(eng.id) || eng.id === user?.id;
                          const locked = eng.id === user?.id;
                          return (
                            <label key={eng.id} className="flex items-start gap-2 text-sm text-text">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={checked}
                                disabled={locked}
                                onChange={(e) =>
                                  setAssignedUserIds((current) => toggleId(current, eng.id, e.target.checked))
                                }
                              />
                              <span>
                                {eng.full_name}
                                <span className="block text-xs text-text-muted">{eng.email}</span>
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Engineer II (reviewers)</p>
                    <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
                      {engineerTwos.length === 0 ? (
                        <p className="text-xs text-text-muted">No Engineer II accounts found.</p>
                      ) : (
                        engineerTwos.map((eng) => (
                          <label key={eng.id} className="flex items-start gap-2 text-sm text-text">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={involvedUserIds.includes(eng.id)}
                              onChange={(e) =>
                                setInvolvedUserIds((current) => toggleId(current, eng.id, e.target.checked))
                              }
                            />
                            <span>
                              {eng.full_name}
                              <span className="block text-xs text-text-muted">{eng.email}</span>
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {editingId !== null && <div className="border-t border-border pt-5"><h3 className="text-sm font-semibold text-text">Project status</h3><select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}><option value="active">Active</option><option value="completed">Completed</option><option value="on_hold">On hold</option></select></div>}
              {editingId !== null && (contractHistory.length > 0 || auditLog.length > 0) && <div className="border-t border-border pt-5"><h3 className="text-sm font-semibold text-text">History</h3>{contractHistory.length > 0 && <div className="mt-3 space-y-2 text-xs">{contractHistory.map((h) => <div key={h.id} className="rounded-lg bg-surface-muted p-3"><span className="font-semibold">₱{formatMoney(h.contract_amount)}</span><span className="text-text-muted"> · effective {h.effective_date}</span><span className="block mt-1 text-text-muted">Recorded {formatWhen(h.created_at)}{h.created_by_name ? ` by ${h.created_by_name}` : ''}</span></div>)}</div>}{auditLog.length > 0 && <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-xs">{auditLog.map((a) => <li key={a.id} className="rounded-lg border border-border p-3"><span className="font-semibold">{a.field_name}</span><span className="text-text-muted"> · {formatWhen(a.created_at)}</span><p className="mt-1 text-text-muted">{a.old_value || '—'} → {a.new_value || '—'}</p></li>)}</ul>}</div>}
            </div>
            <div className="sticky bottom-0 flex gap-3 border-t border-border bg-card px-6 py-4">
              <button type="button" onClick={closeDrawer} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text-muted hover:bg-surface-muted">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : editingId !== null ? 'Save changes' : 'Create project'}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
