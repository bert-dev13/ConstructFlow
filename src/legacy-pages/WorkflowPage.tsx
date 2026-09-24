'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { approveProjectArchive, listProjects, type ProjectRow } from '../lib/projectsApi';
import {
  approveReport,
  listReports,
  rejectReport,
  type SwaStewaReport,
} from '../lib/swaStewaApi';
import {
  canEditReport,
  canUserCreateReportType,
  canUserEditReportType,
  type SwaStewaReportKind,
} from '../lib/reportPermissions';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { usePagination } from '../hooks/usePagination';

const REPORT_TYPES: { type: SwaStewaReportKind; label: string; desc: string; color: string }[] = [
  { type: 'IAR', label: 'IAR', desc: 'Inspection & Acceptance Report', color: 'border-teal-200 bg-teal-50/80' },
  { type: 'STEWA', label: 'STEWA', desc: 'Statement of Time Elapsed & Work Accomplished', color: 'border-amber-200 bg-amber-50/80' },
  { type: 'SWA', label: 'SWA', desc: 'Summary of Work Accomplished', color: 'border-violet-200 bg-violet-50/80' },
];

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_contractor: 'With contractor',
  contractor_confirmed: 'Contractor confirmed',
  pending_review: 'Pending',
  with_engineer_3: 'Pending',
  with_engineer_4: 'Pending',
  approved: 'Approved',
  rejected: 'Revision Requested',
  generated: 'Finalized (in Documents)',
};

type SubmissionTab = 'all' | 'drafts' | 'pending' | 'revisions' | 'approved';
type ReviewerTab = 'queue' | 'archive' | 'register';
type TypeFilter = 'all' | SwaStewaReportKind;
type StatusFilter = 'all' | keyof typeof STATUS_LABELS;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_contractor', label: 'With contractor' },
  { value: 'contractor_confirmed', label: 'Contractor confirmed' },
  { value: 'pending_review', label: 'Pending (Eng II)' },
  { value: 'with_engineer_3', label: 'Pending (Eng III)' },
  { value: 'with_engineer_4', label: 'Pending (Eng IV)' },
  { value: 'rejected', label: 'Revision requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'generated', label: 'Finalized' },
];

export function WorkflowPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [releaseSelections, setReleaseSelections] = useState<
    Record<string, { pdm?: boolean; bar_chart?: boolean; s_curve?: boolean; swa?: boolean; stewa?: boolean }>
  >({});
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [submissionTab, setSubmissionTab] = useState<SubmissionTab>('all');
  const [reviewerTab, setReviewerTab] = useState<ReviewerTab>('queue');

  const isEngineer1 = user?.role === 'engineer_1';
  const isReviewer =
    user?.role === 'engineer_2' || user?.role === 'engineer_3' || user?.role === 'engineer_4';
  const showSubmissionTabs = user?.role === 'engineer_1' || user?.role === 'contractor';

  const creatableTypes = isEngineer1
    ? REPORT_TYPES.filter((rt) => canUserCreateReportType(user?.role, rt.type))
    : [];

  const projectOptions = [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: String(p.id), name: p.name }));

  const hasActiveFilters =
    Boolean(query.trim()) ||
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    projectFilter !== 'all';

  const clearFilters = () => {
    setQuery('');
    setTypeFilter('all');
    setStatusFilter('all');
    setProjectFilter('all');
  };

  const matchesReportFilters = (r: SwaStewaReport) => {
    const q = query.trim().toLowerCase();
    const title = (
      (r.report_data?.project_name as string) ||
      r.project_name ||
      `Project #${r.project_id}`
    ).toLowerCase();
    const matchesQuery =
      !q ||
      title.includes(q) ||
      r.report_number.toLowerCase().includes(q) ||
      r.report_type.toLowerCase().includes(q) ||
      (STATUS_LABELS[r.status] ?? r.status).toLowerCase().includes(q) ||
      String(r.created_by ?? '').toLowerCase().includes(q);
    const matchesType = typeFilter === 'all' || r.report_type === typeFilter;
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    const matchesProject = projectFilter === 'all' || String(r.project_id) === projectFilter;
    return matchesQuery && matchesType && matchesStatus && matchesProject;
  };

  const matchesProjectFilters = (project: ProjectRow) => {
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      [project.name, project.location, project.contractor_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    const matchesProject = projectFilter === 'all' || String(project.id) === projectFilter;
    return matchesQuery && matchesProject;
  };

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const [data, projectData] = await Promise.all([listReports(), listProjects()]);
      setReports(data.reports);
      setProjects(projectData.projects);
    } catch {
      setError('Could not load reports from database.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const pending = reports.filter(
    (r) =>
      matchesReportFilters(r) &&
      (user?.role === 'engineer_2'
        ? r.status === 'pending_review'
        : user?.role === 'engineer_3'
          ? r.status === 'with_engineer_3'
          : user?.role === 'engineer_4'
            ? r.status === 'with_engineer_4'
            : false),
  );

  const myEditable = reports.filter((r) =>
    canEditReport(
      user?.role,
      r.report_type,
      r.status,
      r.edit_user_ids,
      user?.id ? String(user.id) : null,
    ),
  );

  const pendingProjectArchive = projects.filter(
    (project) =>
      matchesProjectFilters(project) && project.lifecycle_state === 'pending_delete_approval',
  );

  const pendingReports = reports.filter((r) =>
    ['pending_review', 'with_engineer_3', 'with_engineer_4', 'pending_contractor', 'contractor_confirmed'].includes(
      r.status,
    ),
  );
  const revisionReports = reports.filter((r) => r.status === 'rejected');
  const approvedReports = reports.filter((r) => r.status === 'approved' || r.status === 'generated');

  const tabReports =
    submissionTab === 'drafts'
      ? myEditable
      : submissionTab === 'pending'
        ? pendingReports
        : submissionTab === 'revisions'
          ? revisionReports
          : submissionTab === 'approved'
            ? approvedReports
            : reports;

  const tableReports = tabReports.filter(matchesReportFilters);
  const filterResetKey = `${query}|${typeFilter}|${statusFilter}|${projectFilter}`;
  const pendingPaging = usePagination(pending, {
    resetKey: `queue|${filterResetKey}`,
  });
  const archivePaging = usePagination(pendingProjectArchive, {
    resetKey: `archive|${filterResetKey}`,
  });
  const tablePaging = usePagination(tableReports, {
    resetKey: `table|${isReviewer ? reviewerTab : submissionTab}|${filterResetKey}`,
  });
  const actorId = user?.id;

  const handleApprove = async (reportId: string) => {
    setActionId(reportId);
    setError('');
    setSuccess('');
    try {
      const result = await approveReport(
        reportId,
        actorId,
        user?.role,
        releaseSelections[reportId],
      );
      if (result.status === 'with_engineer_3') {
        setSuccess('Report approved. Forwarded to Engineer III.');
      } else if (result.status === 'with_engineer_4') {
        setSuccess('Report accepted. Forwarded to Engineer IV.');
      } else if (result.status === 'generated') {
        setSuccess('Report approved. Final email sent to Engineer I–IV and Contractors.');
        if (result.pdf_url) window.open(result.pdf_url, '_blank');
      }
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setActionId(null);
    }
  };

  const handleProjectApprove = async (projectId: string) => {
    setActionId(projectId);
    setError('');
    setSuccess('');
    try {
      const result = await approveProjectArchive(projectId);
      setSuccess(
        result.project.lifecycle_state === 'archived'
          ? 'Project fully approved and moved to archive.'
          : 'Project deletion approval recorded.',
      );
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve project archive.');
    } finally {
      setActionId(null);
    }
  };

  const handleRevise = async (reportId: string) => {
    setActionId(reportId);
    setError('');
    setSuccess('');
    try {
      await rejectReport(reportId, comments[reportId] || 'Revision needed.', actorId);
      setSuccess('Revision request sent to Engineer I.');
      setComments((c) => ({ ...c, [reportId]: '' }));
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request revision');
    } finally {
      setActionId(null);
    }
  };

  const reportTitle = (r: SwaStewaReport) =>
    (r.report_data?.project_name as string) || r.project_name || `Project #${r.project_id}`;

  const reportPeriod = (r: SwaStewaReport) =>
    (r.report_data?.period as string) || r.report_number;

  const reportAuthor = (r: SwaStewaReport) =>
    (r.report_data?.prepared_by_name as string) || 'Engineer I';

  const reviewerTabs: { id: ReviewerTab; label: string; count: number }[] = [
    { id: 'queue', label: 'Approval queue', count: pending.length },
    { id: 'archive', label: 'Project archive', count: pendingProjectArchive.length },
    { id: 'register', label: 'All reports', count: reports.length },
  ];

  const submissionTabs: { id: SubmissionTab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: reports.length },
    { id: 'drafts', label: 'Drafts', count: myEditable.length },
    { id: 'pending', label: 'Pending', count: pendingReports.length },
    { id: 'revisions', label: 'Revisions', count: revisionReports.length },
    { id: 'approved', label: 'Approved', count: approvedReports.length },
  ];

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="space-y-4 px-6 pb-8 pt-5 lg:px-8">
        {isEngineer1 ? (
          <PageHeader
            badge="My Submissions"
            title="My submissions"
            description="Prepare progress reports, submit them for approval, and track their status."
            actions={
              creatableTypes.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {creatableTypes.map((rt) => (
                    <Link
                      key={rt.type}
                      to={`/swa-stewa/new/${rt.type}`}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:opacity-90 ${rt.color}`}
                    >
                      + {rt.label}
                    </Link>
                  ))}
                </div>
              ) : undefined
            }
          />
        ) : (
          <PageHeader
            badge="For Approval"
            title="For Approval"
            description="Review reports and project archive requests assigned to your stage."
          />
        )}

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}
        {success && (
          <div className="rounded-xl bg-primary-light px-4 py-3 text-sm text-primary">{success}</div>
        )}

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {/* Tab bar */}
          <div className="border-b border-border bg-surface-muted/40 px-4 pt-3">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Approval sections">
              {(isReviewer ? reviewerTabs : submissionTabs).map((tab) => {
                const active = isReviewer
                  ? reviewerTab === tab.id
                  : submissionTab === (tab.id as SubmissionTab);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      if (isReviewer) setReviewerTab(tab.id as ReviewerTab);
                      else setSubmissionTab(tab.id as SubmissionTab);
                    }}
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

          {/* Filters */}
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
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block min-w-0">
                <span className="sr-only">Search</span>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <circle cx="11" cy="11" r="7" />
                      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search report, project, author…"
                    className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </label>

              <label className="block min-w-0">
                <span className="sr-only">Report type</span>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                  disabled={isReviewer && reviewerTab === 'archive'}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="all">All report types</option>
                  {REPORT_TYPES.map((rt) => (
                    <option key={rt.type} value={rt.type}>
                      {rt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block min-w-0">
                <span className="sr-only">Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  disabled={
                    (isReviewer && reviewerTab === 'queue') ||
                    (isReviewer && reviewerTab === 'archive')
                  }
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                  title={
                    isReviewer && reviewerTab === 'queue'
                      ? 'Approval queue already shows only items pending your stage'
                      : undefined
                  }
                >
                  {STATUS_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block min-w-0">
                <span className="sr-only">Project</span>
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="all">All projects</option>
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {hasActiveFilters && (
              <p className="mt-2 text-[11px] text-text-muted">
                Showing filtered results
                {typeFilter !== 'all' ? ` · ${typeFilter}` : ''}
                {statusFilter !== 'all' ? ` · ${STATUS_LABELS[statusFilter] ?? statusFilter}` : ''}
                {projectFilter !== 'all'
                  ? ` · ${projectOptions.find((p) => p.id === projectFilter)?.name ?? 'Project'}`
                  : ''}
                {query.trim() ? ` · “${query.trim()}”` : ''}
              </p>
            )}
          </div>

          <div className="p-4" role="tabpanel">
            {loading ? (
              <div className="h-40 animate-pulse rounded-xl bg-surface-muted/60" />
            ) : isReviewer && reviewerTab === 'queue' ? (
              pending.length === 0 ? (
                <EmptyState
                  title="Approval queue is clear"
                  subtitle="No reports are pending your review."
                />
              ) : (
                <div className="space-y-3">
                  {pendingPaging.pageItems.map((rpt) => (
                    <div key={rpt.id} className="rounded-xl border border-border bg-surface/40 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-text">{rpt.report_number}</p>
                          <p className="mt-0.5 text-sm text-text-muted">
                            {rpt.report_type} · {reportTitle(rpt)}
                          </p>
                          <p className="mt-0.5 text-xs text-text-muted">
                            By {reportAuthor(rpt)} · {reportPeriod(rpt)}
                          </p>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase text-amber-800">
                          {STATUS_LABELS[rpt.status] ?? rpt.status.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start">
                        <textarea
                          value={comments[rpt.id] ?? ''}
                          onChange={(e) => setComments((c) => ({ ...c, [rpt.id]: e.target.value }))}
                          placeholder="Revision comment…"
                          className="min-h-[64px] flex-1 rounded-lg border border-border bg-card p-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                          rows={2}
                        />
                        <div className="flex flex-wrap gap-2 lg:w-40 lg:flex-col">
                          <Link
                            to={`/swa-stewa/edit?id=${encodeURIComponent(rpt.id)}`}
                            className="rounded-lg border border-border px-3 py-2 text-center text-xs font-semibold text-text-muted hover:bg-surface-muted"
                          >
                            View
                          </Link>
                          <button
                            type="button"
                            disabled={actionId === rpt.id}
                            onClick={() => handleApprove(rpt.id)}
                            className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {actionId === rpt.id ? 'Saving…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            disabled={actionId === rpt.id}
                            onClick={() => handleRevise(rpt.id)}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
                          >
                            Request revision
                          </button>
                        </div>
                      </div>

                      {user?.role === 'engineer_4' && rpt.report_type === 'IAR' && (
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                          {([
                            ['swa', 'SWA'],
                            ['stewa', 'STEWA'],
                            ['pdm', 'PDM'],
                            ['bar_chart', 'Bar Chart'],
                            ['s_curve', 'S-Curve'],
                          ] as const).map(([key, label]) => (
                            <label key={key} className="inline-flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={releaseSelections[rpt.id]?.[key] === true}
                                onChange={(e) =>
                                  setReleaseSelections((current) => ({
                                    ...current,
                                    [rpt.id]: {
                                      ...current[rpt.id],
                                      [key]: e.target.checked,
                                    },
                                  }))
                                }
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <Pagination
                    page={pendingPaging.page}
                    totalPages={pendingPaging.totalPages}
                    total={pendingPaging.total}
                    from={pendingPaging.from}
                    to={pendingPaging.to}
                    pageSize={pendingPaging.pageSize}
                    onPageChange={pendingPaging.setPage}
                    className="rounded-xl border border-border bg-card"
                  />
                </div>
              )
            ) : isReviewer && reviewerTab === 'archive' ? (
              pendingProjectArchive.length === 0 ? (
                <EmptyState
                  title="No project archive approvals pending"
                  subtitle="Deletion requests from Engineer I will appear here."
                />
              ) : (
                <div className="space-y-3">
                  {archivePaging.pageItems.map((project) => (
                    <div
                      key={project.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-text">{project.name}</p>
                        <p className="mt-1 text-sm text-text-muted">
                          {project.location || 'No location'} · {project.contractor_name || 'No contractor'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={actionId === project.id}
                        onClick={() => handleProjectApprove(project.id)}
                        className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {actionId === project.id ? 'Saving…' : 'Approve archive'}
                      </button>
                    </div>
                  ))}
                  <Pagination
                    page={archivePaging.page}
                    totalPages={archivePaging.totalPages}
                    total={archivePaging.total}
                    from={archivePaging.from}
                    to={archivePaging.to}
                    pageSize={archivePaging.pageSize}
                    onPageChange={archivePaging.setPage}
                    className="rounded-xl border border-border bg-card"
                  />
                </div>
              )
            ) : tableReports.length === 0 ? (
              <EmptyState
                title="No matching reports"
                subtitle={query ? 'Try a different search term.' : 'Reports in this category will appear here.'}
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead className="bg-surface-muted/60">
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                      <th className="px-4 py-2.5 font-semibold">Report</th>
                      <th className="px-4 py-2.5 font-semibold">Project</th>
                      <th className="px-4 py-2.5 font-semibold">Type</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/80">
                    {tablePaging.pageItems.map((rpt) => {
                      const canContinue =
                        canUserEditReportType(user?.role, rpt.report_type) &&
                        (rpt.status === 'draft' || rpt.status === 'rejected');
                      const canEditNow = canEditReport(
                        user?.role,
                        rpt.report_type,
                        rpt.status,
                        rpt.edit_user_ids,
                        user?.id ? String(user.id) : null,
                      );
                      return (
                        <tr key={rpt.id} className="transition hover:bg-surface-muted/40">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-text">{rpt.report_number}</p>
                            <p className="mt-0.5 text-[11px] text-text-muted">
                              {rpt.created_at ? new Date(rpt.created_at).toLocaleDateString() : '—'}
                            </p>
                          </td>
                          <td className="max-w-[280px] px-4 py-3">
                            <p className="truncate font-medium text-text">{reportTitle(rpt)}</p>
                            {rpt.rejection_reason && (
                              <p className="mt-0.5 truncate text-[11px] text-warning">
                                Note: {rpt.rejection_reason}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
                              {rpt.report_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                              {STATUS_LABELS[rpt.status] ?? rpt.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {showSubmissionTabs && (canContinue || (submissionTab === 'drafts' && canEditNow)) ? (
                              <Link
                                to={`/swa-stewa/edit?id=${encodeURIComponent(rpt.id)}`}
                                className="rounded-lg bg-primary-light px-3 py-1.5 text-xs font-semibold text-primary"
                              >
                                {submissionTab === 'drafts' ? 'Edit' : 'Continue'}
                              </Link>
                            ) : (
                              <Link
                                to={
                                  rpt.status === 'generated' || rpt.status === 'approved'
                                    ? `/reports/view?id=${encodeURIComponent(rpt.id)}`
                                    : `/swa-stewa/edit?id=${encodeURIComponent(rpt.id)}`
                                }
                                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted"
                              >
                                View
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                <Pagination
                  page={tablePaging.page}
                  totalPages={tablePaging.totalPages}
                  total={tablePaging.total}
                  from={tablePaging.from}
                  to={tablePaging.to}
                  pageSize={tablePaging.pageSize}
                  onPageChange={tablePaging.setPage}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/40 px-6 py-14 text-center">
      <p className="font-semibold text-text">{title}</p>
      <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
    </div>
  );
}
