'use client';

import { useEffect, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { listReports, type SwaStewaReport } from '../lib/swaStewaApi';
import {
  canUserCreateReportType,
  canUserEditReportType,
  reportIsViewOnly,
  type SwaStewaReportKind,
} from '../lib/reportPermissions';
import { NavIcon } from '../components/NavIcon';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { usePagination } from '../hooks/usePagination';

const REPORT_TYPES: { type: SwaStewaReportKind; label: string; desc: string; color: string }[] = [
  { type: 'IAR', label: 'IAR', desc: 'Inspection & Acceptance Report', color: 'border-teal-200 bg-teal-50/80' },
  { type: 'SWA', label: 'SWA', desc: 'Summary of Work Accomplished', color: 'border-violet-200 bg-violet-50/80' },
  { type: 'STEWA', label: 'STEWA', desc: 'Statement of Time Elapsed & Work Accomplished', color: 'border-amber-200 bg-amber-50/80' },
];

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending',
  with_engineer_3: 'Pending',
  with_engineer_4: 'Pending',
  approved: 'Finalized',
  rejected: 'Revision Requested',
  generated: 'Finalized',
};

const isReviewerRole = (role: string | undefined) =>
  role === 'engineer_2' || role === 'engineer_3' || role === 'engineer_4';

export function ReportsPage() {
  const { user } = useAuth();
  const canManageTemplates = user?.role === 'engineer_4';
  const isContractor = user?.role === 'contractor';
  const isReviewer = isReviewerRole(user?.role);
  const creatableTypes = REPORT_TYPES.filter((rt) => canUserCreateReportType(user?.role, rt.type));
  const canSubmit = creatableTypes.length > 0 && !isReviewer;

  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    listReports()
      .then((res) => setReports(res.reports))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  const isApprovedReport = (status: string) =>
    status === 'approved' || status === 'generated';

  const visible = reports.filter((r) => isApprovedReport(r.status));

  const canEditReport = (rpt: SwaStewaReport) =>
    (rpt.status === 'draft' || rpt.status === 'rejected') &&
    canUserEditReportType(user?.role, rpt.report_type);

  const reportTitle = (r: SwaStewaReport) =>
    (r.report_data?.project_name as string) || r.project_name || `Project #${r.project_id}`;

  const filteredReports = visible.filter((report) => {
    const search = query.trim().toLowerCase();
    const matchesQuery =
      !search ||
      [report.report_number, report.project_name, report.report_type, reportTitle(report)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    const matchesType = typeFilter === 'all' || report.report_type === typeFilter;
    return matchesQuery && matchesType;
  });
  const {
    page,
    setPage,
    pageItems,
    totalPages,
    from,
    to,
    total,
    pageSize,
  } = usePagination(filteredReports, {
    resetKey: `${query}|${typeFilter}`,
  });
  const pendingCount = reports.filter((report) =>
    ['pending_review', 'with_engineer_3', 'with_engineer_4'].includes(report.status),
  ).length;
  const approvedCount = reports.filter((report) => isApprovedReport(report.status)).length;
  const revisionCount = reports.filter((report) => report.status === 'rejected').length;

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="space-y-5 px-8 pb-10 pt-6">
      <PageHeader
        badge={isReviewer ? 'Documents' : 'Reports'}
        title={
          isReviewer
            ? 'Documents'
            : isContractor
              ? 'Progress Reports'
              : 'Report Generation'
        }
        description={
          isReviewer
            ? 'Open any finalized report to review the official document.'
            : isContractor
              ? 'Prepare and edit IAR reports. SWA and STEWA reports from Engineer I are view only.'
              : 'SWA, STEWA, and IAR reports are stored with an official review layout.'
        }
        actions={
          <>
            {canManageTemplates && (
              <Link
                to="/reports/templates"
                className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text transition hover:bg-surface-muted"
              >
                Manage templates
              </Link>
            )}
            {!isReviewer && (
              <Link
                to="/swa-stewa"
                className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text transition hover:bg-surface-muted"
              >
                IAR folders
              </Link>
            )}
          </>
        }
      />

      {canSubmit && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Create a report
          </h2>
          <div className={`grid gap-4 ${creatableTypes.length === 1 ? 'max-w-md' : 'sm:grid-cols-3'}`}>
            {creatableTypes.map((rt) => (
              <Link
                key={rt.type}
                to={`/swa-stewa/new/${rt.type}`}
                className={`group rounded-2xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${rt.color}`}
              >
                <p className="font-bold text-text">{rt.label}</p>
                <p className="mt-1 text-sm text-text-muted">{rt.desc}</p>
                <p className="mt-4 text-xs font-semibold text-primary opacity-0 transition group-hover:opacity-100">
                  Create →
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Total reports', reports.length, 'All submitted and saved reports'],
          ['Pending review', pendingCount, 'Reports moving through approval'],
          ['Approved', approvedCount, 'Finalized reports available'],
          ['Revision requested', revisionCount, 'Reports needing changes'],
        ].map(([label, value, caption]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                <NavIcon name={label === 'Total reports' ? 'reports' : label === 'Approved' ? 'check' : 'approval'} className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-text">{value}</p>
            <p className="mt-1 text-xs text-text-muted">{caption}</p>
          </div>
        ))}
      </div>

      <div id="stored-reports" className="scroll-mt-6 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">{isReviewer ? 'Document register' : 'Report register'}</h2>
        <p className="text-sm text-text-muted">{loading ? 'Loading reports…' : `${filteredReports.length} of ${visible.length} visible reports`}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Search reports</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search report number, project, or type…" className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </label>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text outline-none focus:border-primary">
          <option value="all">All report types</option>
          {REPORT_TYPES.map((type) => <option key={type.type} value={type.type}>{type.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-2xl border border-border bg-card" />
      ) : filteredReports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="font-semibold text-text">{visible.length ? 'No matching reports' : 'No finalized reports yet'}</p>
          <p className="mt-2 text-sm text-text-muted">{visible.length ? 'Try changing your search or filters.' : 'Approved and finalized reports will appear here.'}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-surface-muted/60">
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="px-5 py-3 font-semibold">Report</th>
                  <th className="px-5 py-3 font-semibold">Project</th>
                  <th className="px-5 py-3 font-semibold">Type</th>
                  <th className="px-5 py-3 font-semibold">Submitted</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {pageItems.map((rpt) => (
                  <tr key={rpt.id} className="transition hover:bg-surface-muted/40">
                    <td className="px-5 py-4"><p className="font-semibold text-text">{rpt.report_number}</p><p className="mt-1 text-xs text-text-muted">{new Date(rpt.created_at).toLocaleDateString()}</p></td>
                    <td className="max-w-[280px] px-5 py-4"><p className="truncate font-medium text-text">{reportTitle(rpt)}</p>{rpt.rejection_reason && <p className="mt-1 truncate text-xs text-warning">Revision: {rpt.rejection_reason}</p>}</td>
                    <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${rpt.report_type === 'SWA' ? 'bg-violet-100 text-violet-800' : rpt.report_type === 'STEWA' ? 'bg-amber-100 text-amber-900' : 'bg-teal-100 text-teal-900'}`}>{rpt.report_type}</span></td>
                    <td className="px-5 py-4 text-text-muted">{rpt.created_by || '—'}</td>
                    <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide border-emerald-200 bg-emerald-50 text-emerald-700`}>{STATUS_LABELS[rpt.status] ?? rpt.status.replace(/_/g, ' ')}</span></td>
                    <td className="px-5 py-4"><div className="flex flex-wrap justify-end gap-2">
                      {canEditReport(rpt) && <Link to={`/swa-stewa/edit?id=${encodeURIComponent(rpt.id)}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted hover:bg-surface-muted">Edit</Link>}
                      {(reportIsViewOnly(user?.role, rpt.report_type) || isReviewer || isApprovedReport(rpt.status)) && (
                        <Link
                          to={`/reports/view?id=${encodeURIComponent(rpt.id)}`}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                        >
                          View
                        </Link>
                      )}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    </main>
  );
}
