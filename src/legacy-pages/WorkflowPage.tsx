'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import {
  approveReport,
  listReports,
  rejectReport,
  type SwaStewaReport,
} from '../lib/swaStewaApi';
import {
  canUserCreateReportType,
  canUserEditReportType,
  type SwaStewaReportKind,
} from '../lib/reportPermissions';
import { NavIcon, type NavIconName } from '../components/NavIcon';

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

export function WorkflowPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');

  const isEngineer1 = user?.role === 'engineer_1';

  const creatableTypes = isEngineer1
    ? REPORT_TYPES.filter((rt) => canUserCreateReportType(user?.role, rt.type))
    : [];

  const matchesQuery = (r: SwaStewaReport) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const title = (
      (r.report_data?.project_name as string) ||
      r.project_name ||
      `Project #${r.project_id}`
    ).toLowerCase();
    return (
      title.includes(q) ||
      r.report_number.toLowerCase().includes(q) ||
      r.report_type.toLowerCase().includes(q) ||
      (STATUS_LABELS[r.status] ?? r.status).toLowerCase().includes(q)
    );
  };

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listReports();
      setReports(data.reports);
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
      matchesQuery(r) &&
      (user?.role === 'engineer_2'
        ? r.status === 'pending_review'
        : user?.role === 'engineer_3'
          ? r.status === 'with_engineer_3'
          : user?.role === 'engineer_4'
            ? r.status === 'with_engineer_4' || r.status === 'with_engineer_3'
            : false),
  );

  const myEditable = reports.filter(
    (r) =>
      matchesQuery(r) &&
      (r.status === 'draft' || r.status === 'rejected') &&
      canUserEditReportType(user?.role, r.report_type),
  );

  const allFiltered = reports.filter(matchesQuery);
  const draftCount = reports.filter((r) => r.status === 'draft').length;
  const pendingCount = reports.filter((r) =>
    ['pending_review', 'with_engineer_3', 'with_engineer_4', 'pending_contractor', 'contractor_confirmed'].includes(r.status),
  ).length;
  const revisionCount = reports.filter((r) => r.status === 'rejected').length;
  const approvedCount = reports.filter((r) => r.status === 'approved' || r.status === 'generated').length;

  const actorId = user?.id;

  const handleApprove = async (reportId: string) => {
    setActionId(reportId);
    setError('');
    setSuccess('');
    try {
      const result = await approveReport(reportId, actorId, user?.role);
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

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="space-y-6 px-8 pb-10 pt-6">
      {isEngineer1 ? (
        <>
          <div>
            <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
              My Submissions
            </span>
            <h1 className="mt-3 font-serif text-3xl text-text">My submissions</h1>
            <p className="mt-2 max-w-3xl text-sm text-text-muted">
              Prepare progress reports, submit them for approval, and track their status.
            </p>
          </div>

          {creatableTypes.length > 0 && (
          <div>
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

          <div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by project, report number, type, or status…"
              className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-text shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </>
      ) : (
        <div>
          <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
            For Approval
          </span>
          <h1 className="mt-3 text-2xl font-bold text-text">For Approval</h1>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-600">{error}</div>
      )}
      {success && (
        <div className="mb-4 rounded-xl bg-primary-light p-4 text-sm text-primary">{success}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Total submissions', reports.length, 'All reports in your workflow', 'reports'],
          ['Drafts', draftCount, 'Reports still being prepared', 'planned'],
          ['Pending review', pendingCount, 'Reports moving through workflow', 'approval'],
          ['Revision requested', revisionCount, 'Reports needing changes', 'cross'],
        ].map(([label, value, caption, icon]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                <NavIcon name={icon as NavIconName} className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-text">{value}</p>
            <p className="mt-1 text-xs text-text-muted">{caption}</p>
          </div>
        ))}
      </div>

      {(user?.role === 'engineer_1' || user?.role === 'contractor') && (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-semibold text-text">
            My drafts & revisions ({loading ? '…' : myEditable.length})
          </h2>
          {loading ? (
            <p className="mt-2 text-sm text-text-muted">Loading…</p>
          ) : myEditable.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">No drafts or rejected reports.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {myEditable.map((rpt) => (
                <div
                  key={rpt.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/40 p-4"
                >
                  <div>
                    <p className="font-medium">{reportTitle(rpt)}</p>
                    <p className="text-sm text-text-muted">{rpt.report_type}</p>
                    {rpt.rejection_reason && (
                      <p className="mt-1 text-xs text-warning">Note: {rpt.rejection_reason}</p>
                    )}
                  </div>
                  <Link
                    to={`/swa-stewa/edit/${rpt.id}`}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
                  >
                    Edit report
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(user?.role === 'engineer_2' || user?.role === 'engineer_3' || user?.role === 'engineer_4') && (
        <div className="rounded-2xl border border-primary/30 bg-primary-light/30 p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-text">Approval queue</h2>
              <p className="mt-1 text-sm text-text-muted">Review submitted reports assigned to your approval stage.</p>
            </div>
            <span className="rounded-full border border-primary/20 bg-card px-3 py-1 text-xs font-semibold text-primary">
              {loading ? '…' : `${pending.length} pending`}
            </span>
          </div>
          {loading ? (
            <div className="mt-4 h-40 animate-pulse rounded-xl bg-card/70" />
          ) : pending.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-primary/30 bg-card px-6 py-10 text-center">
              <p className="font-semibold text-text">Approval queue is clear</p>
              <p className="mt-1 text-sm text-text-muted">No reports are pending your review.</p>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
                  <thead className="bg-surface-muted/60">
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                      <th className="px-5 py-3 font-semibold">Report</th>
                      <th className="px-5 py-3 font-semibold">Project</th>
                      <th className="px-5 py-3 font-semibold">Submitted by</th>
                      <th className="px-5 py-3 font-semibold">Stage</th>
                      <th className="px-5 py-3 font-semibold">Revision comment</th>
                      <th className="px-5 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/80">
                    {pending.map((rpt) => (
                      <tr key={rpt.id} className="align-top transition hover:bg-surface-muted/40">
                        <td className="px-5 py-4">
                          <p className="font-semibold text-text">{rpt.report_number}</p>
                          <p className="mt-1 text-xs text-text-muted">{rpt.report_type} · {reportPeriod(rpt)}</p>
                        </td>
                        <td className="max-w-[240px] px-5 py-4">
                          <p className="truncate font-medium text-text">{reportTitle(rpt)}</p>
                        </td>
                        <td className="px-5 py-4 text-text-muted">{reportAuthor(rpt)}</td>
                        <td className="px-5 py-4">
                          <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                            {STATUS_LABELS[rpt.status] ?? rpt.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          {user.role === 'engineer_2' ? (
                            <textarea
                              value={comments[rpt.id] ?? ''}
                              onChange={(e) => setComments((c) => ({ ...c, [rpt.id]: e.target.value }))}
                              placeholder="Add revision comments…"
                              className="w-56 rounded-lg border border-border bg-surface p-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                              rows={2}
                            />
                          ) : (
                            <span className="text-xs text-text-muted">Only Engineer II requests revisions.</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Link to={`/swa-stewa/edit/${rpt.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted hover:bg-surface-muted">View</Link>
                            <button type="button" disabled={actionId === rpt.id} onClick={() => handleApprove(rpt.id)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{actionId === rpt.id ? 'Saving…' : 'Approve'}</button>
                            {user.role === 'engineer_2' && <button type="button" disabled={actionId === rpt.id} onClick={() => handleRevise(rpt.id)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50">Request revision</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">{isEngineer1 ? 'Submission register' : 'All reports'}</h2>
        <p className="text-sm text-text-muted">{allFiltered.length} matching reports · {approvedCount} approved</p>
      </div>
      {loading ? (
        <p className="text-sm text-text-muted">Loading reports…</p>
      ) : allFiltered.length === 0 ? (
        <p className="text-sm text-text-muted">No reports match your search.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-surface-muted/60">
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="px-5 py-3 font-semibold">Report</th>
                  <th className="px-5 py-3 font-semibold">Project</th>
                  <th className="px-5 py-3 font-semibold">Type</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {allFiltered.map((rpt) => (
                  <tr key={rpt.id} className="transition hover:bg-surface-muted/40">
                    <td className="px-5 py-4"><p className="font-semibold text-text">{rpt.report_number}</p><p className="mt-1 text-xs text-text-muted">{rpt.created_at ? new Date(rpt.created_at).toLocaleDateString() : '—'}</p></td>
                    <td className="max-w-[320px] px-5 py-4"><p className="truncate font-medium text-text">{reportTitle(rpt)}</p>{rpt.rejection_reason && <p className="mt-1 truncate text-xs text-warning">Note: {rpt.rejection_reason}</p>}</td>
                    <td className="px-5 py-4"><span className="rounded-full bg-primary-light px-2.5 py-1 text-[10px] font-bold uppercase text-primary">{rpt.report_type}</span></td>
                    <td className="px-5 py-4"><span className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{STATUS_LABELS[rpt.status] ?? rpt.status.replace(/_/g, ' ')}</span></td>
                    <td className="px-5 py-4 text-right">{canUserEditReportType(user?.role, rpt.report_type) && (rpt.status === 'draft' || rpt.status === 'rejected') ? <Link to={`/swa-stewa/edit/${rpt.id}`} className="rounded-lg bg-primary-light px-3 py-1.5 text-xs font-semibold text-primary">Continue</Link> : <Link to={`/swa-stewa/edit/${rpt.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-muted">View</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
