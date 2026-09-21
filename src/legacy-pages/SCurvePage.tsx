'use client';

import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ProjectSelect } from '../components/ProjectSelect';
import { DocumentsBackLink } from '../components/DocumentsBackLink';
import { ReportProgressFeed, type ReportProgressEntry } from '../components/ReportProgressFeed';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { getSCurve,
  type SCurveActivity,
  type SCurveComparison,
  type ScheduleStatus,
  type SCurveSnapshotSummary,
} from '../lib/sCurveApi';
import type { SCurvePoint } from '../types';
import { exportSCurvePdf } from '../lib/chartPdfExport';
import { NavIcon, type NavIconName } from '../components/NavIcon';

const STATUS_STYLES: Record<string, { badge: string; label: string }> = {
  target_only: { badge: 'bg-blue-50 text-blue-800', label: 'Target Plan only' },
  on_schedule: { badge: 'bg-primary-light text-primary', label: 'On Track' },
  ahead: { badge: 'bg-emerald-50 text-emerald-800', label: 'Ahead' },
  behind: { badge: 'bg-red-50 text-red-800', label: 'Behind' },
  unknown: { badge: 'bg-surface-muted text-text-muted', label: 'Status unknown' },
};

function formatSnapshotLabel(version: SCurveSnapshotSummary): string {
  const when = new Date(version.captured_at).toLocaleString();
  const label = version.trigger_label ?? version.trigger_type.replace(/_/g, ' ');
  return `${when} — ${label}`;
}

export function SCurvePage() {
  const { projectId, setProjectId } = useSelectedProject();
  const [points, setPoints] = useState<SCurvePoint[]>([]);
  const [activities, setActivities] = useState<SCurveActivity[]>([]);
  const [criticalPath, setCriticalPath] = useState<string[]>([]);
  const [syncedFromPdm, setSyncedFromPdm] = useState(false);
  const [hasActualProgress, setHasActualProgress] = useState(false);
  const [hasRevisedSchedule, setHasRevisedSchedule] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus | null>(null);
  const [comparisons, setComparisons] = useState<SCurveComparison[]>([]);
  const [reportFeed, setReportFeed] = useState<ReportProgressEntry[]>([]);
  const [latestReportPercent, setLatestReportPercent] = useState<number | null>(null);
  const [latestReportDate, setLatestReportDate] = useState<string | null>(null);
  const [versions, setVersions] = useState<SCurveSnapshotSummary[]>([]);
  const [viewingSnapshotId, setViewingSnapshotId] = useState<string | null>(null);
  const [viewingSnapshotLabel, setViewingSnapshotLabel] = useState<string | null>(null);
  const [projectStartDate, setProjectStartDate] = useState<string | null>(null);
  const [projectEndDate, setProjectEndDate] = useState<string | null>(null);
  const [targetPlanPercent, setTargetPlanPercent] = useState<number | null>(null);
  const [actualPlanPercent, setActualPlanPercent] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    setViewingSnapshotId(null);
  }, [projectId]);

  useEffect(() => {
    setChartReady(true);
  }, []);

  useEffect(() => {
    setLoading(true);
    getSCurve(projectId, viewingSnapshotId)
      .then((res) => {
        setPoints(res.points);
        setActivities(res.activities);
        setCriticalPath(res.critical_path);
        setSyncedFromPdm(res.synced_from_pdm);
        setHasActualProgress(res.has_actual_progress);
        setHasRevisedSchedule(res.has_revised_schedule);
        setScheduleStatus(res.schedule_status);
        setComparisons(res.comparisons ?? []);
        setReportFeed(res.report_feed ?? []);
        setLatestReportPercent(res.latest_report_percent);
        setLatestReportDate(res.latest_report_date);
        setVersions(res.versions ?? []);
        setViewingSnapshotLabel(res.viewing_snapshot_label);
        setProjectStartDate(res.project_start_date ?? null);
        setProjectEndDate(res.project_end_date ?? null);
        setTargetPlanPercent(res.target_plan_percent ?? null);
        setActualPlanPercent(res.actual_plan_percent ?? null);
      })
      .catch(() => {
        setPoints([]);
        setActivities([]);
        setCriticalPath([]);
        setSyncedFromPdm(false);
        setHasActualProgress(false);
        setHasRevisedSchedule(false);
        setScheduleStatus(null);
        setComparisons([]);
        setReportFeed([]);
        setLatestReportPercent(null);
        setLatestReportDate(null);
        setVersions([]);
        setViewingSnapshotLabel(null);
        setProjectStartDate(null);
        setProjectEndDate(null);
        setTargetPlanPercent(null);
        setActualPlanPercent(null);
      })
      .finally(() => setLoading(false));
  }, [projectId, viewingSnapshotId]);

  const statusStyle = STATUS_STYLES[scheduleStatus?.status ?? 'unknown'] ?? STATUS_STYLES.unknown;
  const variance =
    targetPlanPercent != null && actualPlanPercent != null
      ? actualPlanPercent - targetPlanPercent
      : null;

  return (
    <main className="flex-1 overflow-y-auto">
      <DocumentsBackLink />
      <div className="space-y-6 px-8 pb-10 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
            Schedule workspace
          </span>
          <h1 className="mt-3 font-serif text-3xl text-text">S-Curve analysis</h1>
          {(projectStartDate || projectEndDate) && (
            <p className="mt-2 text-sm font-medium text-text">
              Project timeline:{' '}
              <span className="text-primary">
                {projectStartDate
                  ? new Date(`${projectStartDate}T00:00:00`).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : '—'}
              </span>
              {' → '}
              <span className="text-primary">
                {projectEndDate
                  ? new Date(`${projectEndDate}T00:00:00`).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : '—'}
              </span>
            </p>
          )}
          <p className="mt-2 max-w-3xl text-sm text-text-muted">
            Compare target and actual progress over time to understand project performance and schedule variance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {scheduleStatus && (
            <div className={`rounded-xl px-4 py-2 text-right ${statusStyle.badge}`}>
              <p className="text-[10px] font-bold uppercase tracking-wide">{statusStyle.label}</p>
              <p className="text-sm font-semibold">{scheduleStatus.label}</p>
              {scheduleStatus.planned_pct != null && (
                <p className="text-xs opacity-80">
                  Target {scheduleStatus.planned_pct}%
                  {scheduleStatus.actual_pct != null
                    ? ` · Actual ${scheduleStatus.actual_pct}%`
                    : ''}
                </p>
              )}
            </div>
          )}
          <ProjectSelect value={projectId} onChange={setProjectId} className="min-w-[240px]" />
          <button
            type="button"
            disabled={exporting || points.length === 0}
            onClick={() => {
              setExporting(true);
              try {
                exportSCurvePdf({
                  projectLabel: `Project ${projectId}`,
                  points,
                  comparisons,
                  status: scheduleStatus,
                  targetPlanPercent,
                  actualPlanPercent,
                });
              } finally {
                setExporting(false);
              }
            }}
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-text transition hover:bg-surface-muted disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export S-Curve PDF'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ['Target plan', targetPlanPercent != null ? `${targetPlanPercent}%` : '—', 'Baseline approved progress', 'planned'],
          ['Actual progress', actualPlanPercent != null ? `${actualPlanPercent}%` : '—', latestReportDate ? `Latest report ${latestReportDate}` : 'No approved report yet', 'actual'],
          ['Schedule variance', variance != null ? `${variance > 0 ? '+' : ''}${variance}%` : '—', variance == null ? 'Waiting for actual progress' : variance < 0 ? 'Behind target plan' : variance > 0 ? 'Ahead of target plan' : 'Matching target plan', 's-curve'],
          ['Critical path', criticalPath.length, syncedFromPdm ? 'Synced from PDM schedule' : 'Not synced from PDM', 'approval'],
        ] as [string, string | number, string, NavIconName][]).map(([label, value, caption, icon]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                <NavIcon name={icon} className="h-5 w-5" />
              </span>
            </div>
            <p className={`mt-3 text-2xl font-semibold ${label === 'Schedule variance' && variance != null ? variance < 0 ? 'text-red-600' : 'text-emerald-700' : 'text-text'}`}>{value}</p>
            <p className="mt-1 truncate text-xs text-text-muted" title={caption}>{caption}</p>
          </div>
        ))}
      </div>

      <ReportProgressFeed
        reports={reportFeed}
        latestPercent={latestReportPercent}
        latestDate={latestReportDate}
        emptyMessage="No approved SWA or STEWA reports yet — Target Plan appears after the first approved progress."
      />

      {comparisons.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-text">Target plan vs. actual</h2>
          <p className="mt-1 text-sm text-text-muted">
            At each reporting date, compare what the baseline schedule expected versus what was
            actually accomplished.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-text-muted">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3 text-[#2563eb]">Target Plan %</th>
                  <th className="py-2 pr-3 text-[#f97316]">Actual %</th>
                  <th className="py-2 pr-3">Difference</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((row) => (
                  <tr key={row.date} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-medium">{row.date_label}</td>
                    <td className="py-2 pr-3 font-semibold text-[#2563eb]">{row.target_pct}%</td>
                    <td className="py-2 pr-3 font-semibold text-[#f97316]">{row.actual_pct}%</td>
                    <td className="py-2 pr-3">
                      {row.variance_pct > 0 ? '+' : ''}
                      {row.variance_pct}%
                    </td>
                    <td
                      className={`py-2 capitalize ${
                        row.status === 'behind'
                          ? 'text-red-700'
                          : row.status === 'ahead'
                            ? 'text-emerald-700'
                            : 'text-text-muted'
                      }`}
                    >
                      {row.status_label}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-text">Progress curve</h2>
            <p className="mt-1 text-sm text-text-muted">Cumulative progress against the approved baseline and latest reports.</p>
          </div>
          {versions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="scurve-version" className="text-xs font-medium text-text-muted">
                Version history
              </label>
              <select
                id="scurve-version"
                value={viewingSnapshotId ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setViewingSnapshotId(val === '' ? null : val);
                }}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              >
                <option value="">Current (latest)</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {formatSnapshotLabel(v)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {viewingSnapshotLabel && (
          <p className="mt-2 text-center text-xs text-amber-700 sm:text-left">
            Viewing archived snapshot: <strong>{viewingSnapshotLabel}</strong>
          </p>
        )}

        {loading ? (
          <div className="mt-6 h-80 animate-pulse rounded-xl bg-surface-muted" />
        ) : points.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-16 text-center">
            <p className="font-semibold text-text">No S-curve points recorded yet</p>
            <p className="mt-2 text-sm text-text-muted">Approved progress reports will populate the target and actual curves.</p>
          </div>
        ) : (
          <>
            <div className="mt-4 h-80 w-full">
              {chartReady ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e0dfd8" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#000000', fontSize: 10 }}
                    angle={-35}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
                    tick={{ fill: '#000000', fontSize: 11 }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as SCurvePoint | undefined;
                      const target = row?.originalPlan;
                      const actual = row?.actual;
                      return (
                        <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                          <p className="font-semibold text-text">{label}</p>
                          {target != null && (
                            <p className="text-[#2563eb]">Target Plan: {target}%</p>
                          )}
                          {actual != null && (
                            <p className="text-[#f97316]">Actual Plan: {actual}%</p>
                          )}
                          {target != null && actual != null && (
                            <p className="mt-1 text-text-muted">
                              {actual > target
                                ? 'Ahead'
                                : actual < target
                                  ? 'Behind'
                                  : 'On Track'}
                              {' · '}
                              {Math.abs(actual - target).toFixed(1)}% variance
                            </p>
                          )}
                          {row?.label && (
                            <p className="mt-1 text-text-muted">{row.label}</p>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="originalPlan"
                    name="Target Plan %"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 4, fill: '#2563eb' }}
                    connectNulls
                  />
                  {hasRevisedSchedule && (
                    <Line
                      type="monotone"
                      dataKey="currentPlan"
                      name="Revised Schedule %"
                      stroke="#7c3aed"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      dot={{ r: 3, fill: '#7c3aed' }}
                      connectNulls
                    />
                  )}
                  {hasActualProgress && (
                    <Line
                      type="monotone"
                      dataKey="actual"
                    name="Actual Plan %"
                    stroke="#f97316"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#f97316' }}
                      connectNulls
                    />
                  )}
                  {hasActualProgress &&
                    scheduleStatus?.planned_pct != null &&
                    scheduleStatus.actual_pct != null && (
                      <ReferenceLine
                        y={scheduleStatus.planned_pct}
                        stroke="#2563eb"
                        strokeDasharray="2 6"
                        strokeOpacity={0.35}
                      />
                    )}
                </LineChart>
              </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-text-muted">
                  Loading chart…
                </div>
              )}
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full border-collapse text-center text-xs">
                <thead>
                  <tr className="border-b-2 border-text bg-surface-muted">
                    <th className="p-2 text-left font-bold">Curve</th>
                    {points.map((p) => (
                      <th key={p.pointDate ?? p.date} className="border-l border-border p-2 font-normal">
                        {p.date}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="p-2 text-left font-semibold text-[#2563eb]">Target Plan %</td>
                    {points.map((p) => (
                      <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                        {p.originalPlan != null ? `${p.originalPlan}%` : ''}
                      </td>
                    ))}
                  </tr>
                  {hasRevisedSchedule && (
                    <tr className="border-b border-border">
                      <td className="p-2 text-left font-semibold text-[#7c3aed]">Revised Schedule %</td>
                      {points.map((p) => (
                        <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                          {p.currentPlan != null ? `${p.currentPlan}%` : ''}
                        </td>
                      ))}
                    </tr>
                  )}
                  {hasActualProgress && (
                    <tr className="border-b border-border">
                      <td className="p-2 text-left font-semibold text-[#f97316]">Actual %</td>
                      {points.map((p) => (
                        <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                          {p.actual != null ? `${p.actual}%` : ''}
                        </td>
                      ))}
                    </tr>
                  )}
                  {hasActualProgress && (
                    <tr className="border-t border-border">
                      <td className="p-2 text-left font-semibold text-text-muted">Gap (Actual − Target)</td>
                      {points.map((p) => (
                        <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                          {p.variance != null ? (
                            <span
                              className={
                                p.variance < 0
                                  ? 'text-red-700'
                                  : p.variance > 0
                                    ? 'text-emerald-700'
                                    : ''
                              }
                            >
                              {p.variance > 0 ? '+' : ''}
                              {p.variance}%
                            </span>
                          ) : (
                            ''
                          )}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="mt-4 text-xs text-text-muted">
          {hasActualProgress
            ? 'Compare Actual against the Target Plan to see on-schedule, ahead, or delayed progress. Slippage triggers revised schedule updates when the PDM is changed.'
            : 'Target Plan is the baseline. The Actual curve appears once approved progress reports are recorded.'}
          {syncedFromPdm && criticalPath.length > 0 && (
            <> Critical path: <strong>{criticalPath.join(' → ')}</strong>.</>
          )}
        </p>
      </div>

      {versions.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h3 className="font-semibold text-text">S-Curve version history</h3>
          <p className="mt-1 text-sm text-text-muted">
            Snapshots are saved when the schedule is revised or when approved progress reports are
            finalized.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-text-muted">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Trigger</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Target %</th>
                  <th className="py-2 pr-3">Actual %</th>
                  <th className="py-2">Slippage</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="border-b border-border/50">
                    <td className="py-2 pr-3">{new Date(v.captured_at).toLocaleString()}</td>
                    <td className="py-2 pr-3">{v.trigger_label ?? v.trigger_type}</td>
                    <td className="py-2 pr-3 capitalize">
                      {(v.schedule_status ?? '—').replace(/_/g, ' ')}
                    </td>
                    <td className="py-2 pr-3">{v.planned_pct != null ? `${v.planned_pct}%` : '—'}</td>
                    <td className="py-2 pr-3">{v.actual_pct != null ? `${v.actual_pct}%` : '—'}</td>
                    <td className="py-2">
                      {v.slippage_pct != null ? `${v.slippage_pct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activities.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h3 className="font-semibold text-text">PDM activities on this S-curve</h3>
          <p className="mt-1 text-sm text-text-muted">
            Each row is one PDM activity. Planned % is cumulative when that activity finishes.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-text-muted">
                  <th className="py-2 pr-3">No.</th>
                  <th className="py-2 pr-3">Activity</th>
                  <th className="py-2 pr-3">Duration</th>
                  <th className="py-2 pr-3">ES</th>
                  <th className="py-2 pr-3">EF</th>
                  <th className="py-2 pr-3">Finish date</th>
                  <th className="py-2 pr-3">Planned %</th>
                  <th className="py-2">Critical</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={`${a.number}-${a.name}`} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-medium">{a.number}</td>
                    <td className="py-2 pr-3">{a.name}</td>
                    <td className="py-2 pr-3">{a.duration}d</td>
                    <td className="py-2 pr-3">{a.es}</td>
                    <td className="py-2 pr-3">{a.ef}</td>
                    <td className="py-2 pr-3">{a.finish_date}</td>
                    <td className="py-2 pr-3 font-medium text-primary">{a.planned_pct}%</td>
                    <td className="py-2">{a.is_critical ? 'Yes' : '—'}</td>
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
