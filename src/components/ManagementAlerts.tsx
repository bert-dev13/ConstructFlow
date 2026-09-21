'use client';

import { useEffect, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { ALERTS } from '../data/mockData';
import type { Role } from '../types';
import { listReports, type SwaStewaReport } from '../lib/swaStewaApi';
import { NavIcon } from './NavIcon';

const APPROVED_STATUSES = new Set(['approved', 'generated']);

function projectTitleOf(r: SwaStewaReport): string {
  return (
    (r.report_data?.project_title as string) ||
    (r.report_data?.project_name as string) ||
    r.project_name ||
    `Project #${r.project_id}`
  );
}

function ContractorIarAlerts() {
  const [reports, setReports] = useState<SwaStewaReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listReports({ type: 'IAR' })
      .then((d) => setReports(d.reports))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  const approvedCount = reports.filter((r) => APPROVED_STATUSES.has(r.status)).length;
  const pendingCount = reports.length - approvedCount;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-text">IAR Status</h3>
      <p className="mt-1 text-sm text-text-muted">Approval status of your inspection reports</p>

      {loading ? (
        <p className="mt-4 text-sm text-text-muted">Loading IAR reports…</p>
      ) : reports.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">No IAR reports yet.</p>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-surface/60 p-4">
            <div>
              <p className="font-medium text-text">IAR approvals</p>
              <p className="mt-0.5 text-sm text-text-muted">
                {approvedCount} approved · {pendingCount} pending approval
              </p>
            </div>
            <span className="text-2xl font-bold text-text">
              {approvedCount}/{reports.length}
            </span>
          </div>

          <ul className="mt-3 space-y-3">
            {reports.map((r) => {
              const approved = APPROVED_STATUSES.has(r.status);
              return (
                <li key={r.id}>
                  <Link
                    to="/swa-stewa"
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/60 p-4 transition hover:bg-surface-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text">{projectTitleOf(r)}</p>
                      <p className="truncate font-mono text-xs text-text-muted">{r.report_number}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        approved ? 'bg-primary-light text-primary' : 'bg-warning-bg text-warning'
                      }`}
                    >
                      {approved ? 'Approved' : 'Pending'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export function ManagementAlerts({ role }: { role?: Role }) {
  if (role === 'contractor') {
    return <ContractorIarAlerts />;
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-text">Management Alerts</h3>
          <p className="mt-1 text-sm text-text-muted">Items needing attention</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <NavIcon name="approval" className="h-5 w-5" />
        </span>
      </div>

      <ul className="mt-4 space-y-3">
        {ALERTS.map((alert) => (
          <li
            key={alert.id}
            className="rounded-xl border border-border bg-surface/60 p-4 transition hover:bg-surface-muted/50"
          >
            {alert.type === 'summary' ? (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-text">{alert.title}</p>
                  <p className="mt-0.5 text-sm text-text-muted">{alert.subtitle}</p>
                </div>
                <span className="text-2xl font-bold text-text">{alert.count}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-text">{alert.title}</p>
                  {'subtitle' in alert && alert.subtitle && (
                    <p className="text-xs text-text-muted">{alert.subtitle}</p>
                  )}
                </div>
                {'tag' in alert && (
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                      alert.tag === 'DELAYED'
                        ? 'bg-warning-bg text-warning'
                        : 'bg-pm-tag text-text-muted'
                    }`}
                  >
                    {alert.tag}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
