'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import {
  createProject,
  getProject,
  listContractors,
  listProjects,
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

function scheduleHealth(project: ProjectRow): { label: string; className: string } {
  if (project.status === 'completed') return { label: 'Completed', className: 'text-sky-700' };
  if (project.status === 'on_hold') return { label: 'On hold', className: 'text-amber-700' };
  if (project.planned_end_date && new Date(project.planned_end_date) < new Date()) {
    return { label: 'Past planned end', className: 'text-red-600' };
  }
  return { label: 'On track', className: 'text-emerald-700' };
}

export function ProjectsPage() {
  const { user } = useAuth();
  const { setProjectId } = useSelectedProject();
  const canManage = user?.role === 'engineer_1';

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [contractors, setContractors] = useState<ContractorOption[]>([]);
  const [auditLog, setAuditLog] = useState<ProjectAuditEntry[]>([]);
  const [contractHistory, setContractHistory] = useState<ContractHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('recent');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [contractAmount, setContractAmount] = useState('');
  const [status, setStatus] = useState('active');

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setLocation('');
    setStartDate('');
    setPlannedEnd('');
    setContractorId('');
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
    try {
      const [projRes, contractorRes] = await Promise.all([listProjects(), listContractors()]);
      setProjects(projRes.projects);
      setContractors(contractorRes.contractors);
    } catch {
      setError('Could not load projects from database.');
    } finally {
      setLoading(false);
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
      const input = {
        name: name.trim(),
        location: location.trim() || undefined,
        start_date: startDate || undefined,
        planned_end_date: plannedEnd || undefined,
        status: status || 'active',
        contractor_id: contractorId || null,
        contract_amount: contractAmount ? parseFloat(contractAmount) : null,
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

  const openCreate = () => {
    resetForm();
    setError('');
    setSuccess('');
    setDrawerOpen(true);
  };

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = projects.filter((project) => {
      const matchesQuery =
        !normalizedQuery ||
        [project.name, project.location, project.contractor_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      return matchesQuery && matchesStatus;
    });

    return result.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'value') return (b.contract_amount ?? 0) - (a.contract_amount ?? 0);
      if (sortBy === 'start') return (a.start_date ?? '').localeCompare(b.start_date ?? '');
      return (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? '');
    });
  }, [projects, query, sortBy, statusFilter]);

  const activeCount = projects.filter((project) => project.status === 'active').length;
  const onHoldCount = projects.filter((project) => project.status === 'on_hold').length;
  const completedCount = projects.filter((project) => project.status === 'completed').length;
  const totalContractValue = projects.reduce((sum, project) => sum + (project.contract_amount ?? 0), 0);

  const inputCls =
    'mt-1.5 w-full rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm text-text shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

  return (
    <main className="min-h-screen flex-1 overflow-y-auto bg-surface">
      <div className="space-y-6 px-8 pb-10 pt-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
              Engineer I · Portfolio
            </span>
            <h1 className="mt-3 font-serif text-3xl text-text">Projects</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
              Keep project information, contract details, and delivery status in one place.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={openCreate}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
            >
              <span className="mr-2 text-lg leading-none">+</span>
              New project
            </button>
          )}
        </div>

        {error && <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>}
        {success && <div className="mt-6 rounded-xl border border-primary/20 bg-primary-light p-4 text-sm text-primary">{success}</div>}

        <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([
            ['Total projects', projects.length, 'All registered projects', 'projects'],
            ['Active', activeCount, 'Currently in delivery', 'schedule'],
            ['On hold', onHoldCount, 'Needs attention', 'approval'],
            ['Contract value', `₱${formatMoney(totalContractValue)}`, 'Across all projects', 'reports'],
          ] as [string, string | number, string, NavIconName][]).map(([label, value, caption, icon]) => (
            <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                  <NavIcon name={icon} className="h-5 w-5" />
                </span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-text">{value}</p>
              <p className="mt-1 text-xs text-text-muted">{caption}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search projects</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by project, location, or contractor…"
              className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text outline-none focus:border-primary">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="completed">Completed</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text outline-none focus:border-primary">
            <option value="recent">Recently updated</option>
            <option value="name">Project name</option>
            <option value="value">Contract value</option>
            <option value="start">Start date</option>
          </select>
        </div>

        <div className="mt-8 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text">Project portfolio</h2>
            <p className="mt-1 text-sm text-text-muted">
              {loading ? 'Loading projects…' : `${filteredProjects.length} of ${projects.length} projects`}
            </p>
          </div>
          {completedCount > 0 && <p className="text-sm text-text-muted">{completedCount} completed</p>}
        </div>

        {loading ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {[1, 2].map((item) => <div key={item} className="h-52 animate-pulse rounded-2xl border border-border bg-card" />)}
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
            <p className="font-semibold text-text">{projects.length ? 'No matching projects' : 'No projects yet'}</p>
            <p className="mt-2 text-sm text-text-muted">
              {projects.length ? 'Try changing your search or filters.' : 'Create your first project to begin tracking delivery.'}
            </p>
            {!projects.length && canManage && (
              <button type="button" onClick={openCreate} className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">
                Create first project
              </button>
            )}
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead className="bg-surface-muted/60">
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                    <th className="px-5 py-3 font-semibold">Project</th>
                    <th className="px-5 py-3 font-semibold">Contractor</th>
                    <th className="px-5 py-3 font-semibold">Contract value</th>
                    <th className="px-5 py-3 font-semibold">Schedule</th>
                    <th className="px-5 py-3 font-semibold">Planned end</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/80">
                  {filteredProjects.map((p) => {
                    const health = scheduleHealth(p);
                    return (
                      <tr key={p.id} className="transition hover:bg-surface-muted/40">
                        <td className="px-5 py-4">
                          <p className="font-semibold text-text">{p.name}</p>
                          <p className="mt-1 text-xs text-text-muted">{p.location || 'Location not set'}</p>
                        </td>
                        <td className="px-5 py-4 text-sm text-text">{p.contractor_name || 'Not assigned'}</td>
                        <td className="px-5 py-4 text-sm font-medium text-text">
                          {p.contract_amount != null ? `₱${formatMoney(p.contract_amount)}` : 'Not set'}
                        </td>
                        <td className={`px-5 py-4 text-sm font-medium ${health.className}`}>{health.label}</td>
                        <td className="px-5 py-4 text-sm text-text">{dateInputValue(p.planned_end_date) || 'Not set'}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusClass(p.status)}`}>
                            {statusLabel(p.status)}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => setProjectId(String(p.id))} className="rounded-lg bg-primary-light px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-light/70">
                              Select
                            </button>
                            {canManage && <Link to={`/projects/${p.id}/boq`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted hover:bg-surface-muted">BOQ</Link>}
                            {canManage && <button type="button" onClick={() => startRevise(p)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted hover:bg-surface-muted">Edit</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
                  <div><label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">Contractor</label><select value={contractorId} onChange={(e) => setContractorId(e.target.value)} className={inputCls}><option value="">— Select contractor —</option>{contractors.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></div>
                  <div><label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">Contract amount (₱)</label><input type="number" step="0.01" min="0" value={contractAmount} onChange={(e) => setContractAmount(e.target.value)} placeholder="5991119.01" className={inputCls} /></div>
                  <div><label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">Start date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></div>
                  <div><label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">Planned end date</label><input type="date" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} className={inputCls} /></div>
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
