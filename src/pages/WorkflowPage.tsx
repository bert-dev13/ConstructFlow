import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

const ACTOR_ID_BY_ROLE: Record<string, number> = {
  engineer_1: 1,
  engineer_2: 2,
  engineer_3: 3,
  engineer_4: 4,
};

export function WorkflowPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
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

  const actorId = user?.id && user.id > 0 ? user.id : ACTOR_ID_BY_ROLE[user?.role ?? ''] ?? 1;

  const handleApprove = async (reportId: number) => {
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

  const handleRevise = async (reportId: number) => {
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
    <main className="flex-1 overflow-y-auto p-8">
      {isEngineer1 ? (
        <>
          <div className="mb-6">
            <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
              My Submissions
            </span>
            <h1 className="mt-3 text-2xl font-bold text-text">My Submissions</h1>
            <p className="mt-2 max-w-3xl text-sm text-text-muted">
              Prepare progress reports, submit them for approval, and track their status.
            </p>
          </div>

          {creatableTypes.length > 0 && (
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

          <div className="mb-6">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by project, report number, type, or status…"
              className="w-full max-w-md rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm text-text shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </>
      ) : (
        <div className="mb-6">
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

      {(user?.role === 'engineer_1' || user?.role === 'contractor') && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-5">
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
        <div className="mb-6 rounded-2xl border border-primary/30 bg-primary-light/50 p-5">
          <h2 className="font-semibold text-text">
            For Approval ({loading ? '…' : pending.length})
          </h2>
          {loading ? (
            <p className="mt-2 text-sm text-text-muted">Loading…</p>
          ) : pending.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">No reports pending your review.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {pending.map((rpt) => (
                <div key={rpt.id} className="rounded-xl border border-border bg-card p-4">
                  <p className="font-medium">{reportTitle(rpt)}</p>
                  <p className="text-sm text-text-muted">
                    {rpt.report_type} · {reportPeriod(rpt)} · from {reportAuthor(rpt)}
                  </p>
                  <p className="mt-1 font-mono text-xs text-text-muted">{rpt.report_number}</p>
                  {user.role === 'engineer_2' && (
                    <textarea
                      value={comments[rpt.id] ?? ''}
                      onChange={(e) =>
                        setComments((c) => ({ ...c, [rpt.id]: e.target.value }))
                      }
                      placeholder="Revision comments for Engineer I..."
                      className="mt-3 w-full rounded-lg border border-border bg-surface p-2 text-sm"
                      rows={2}
                    />
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to={`/swa-stewa/edit/${rpt.id}`}
                      className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-text transition hover:bg-surface-muted"
                    >
                      View report
                    </Link>
                    <button
                      type="button"
                      disabled={actionId === rpt.id}
                      onClick={() => handleApprove(rpt.id)}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {actionId === rpt.id ? 'Saving…' : 'Approve'}
                    </button>
                    {user.role === 'engineer_2' && (
                      <button
                        type="button"
                        disabled={actionId === rpt.id}
                        onClick={() => handleRevise(rpt.id)}
                        className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        Request Revision
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <h2 className="mb-4 text-lg font-semibold text-text">All Reports</h2>
      {loading ? (
        <p className="text-sm text-text-muted">Loading reports…</p>
      ) : allFiltered.length === 0 ? (
        <p className="text-sm text-text-muted">No reports match your search.</p>
      ) : (
        <div className="space-y-3">
          {allFiltered.map((rpt) => (
            <div
              key={rpt.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div>
                <p className="font-medium">{reportTitle(rpt)}</p>
                <p className="text-sm text-text-muted">{rpt.report_type}</p>
                {rpt.rejection_reason && (
                  <p className="mt-1 text-xs text-warning">Note: {rpt.rejection_reason}</p>
                )}
              </div>
              <span className="font-mono text-xs text-text-muted">{rpt.report_number}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
