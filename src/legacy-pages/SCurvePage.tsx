'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { getSCurve,
  saveSCurveCostItems,
  saveSCurveSettings,
  type SCurveActivity,
  type SCurveCostItem,
  type SCurveComparison,
  type SCurvePeriodRow,
  type SCurveReportingInterval,
  type ScheduleStatus,
  type SCurveSnapshotSummary,
  type SCurveType,
} from '../lib/sCurveApi';
import { computeSCurveCostSummary } from '../lib/sCurveItems';
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

const INTERVAL_LABELS: Record<SCurveReportingInterval, string> = {
  '10_day': '10-Day Interval',
  '30_day': '30-Day / Monthly',
};

function formatSnapshotLabel(version: SCurveSnapshotSummary): string {
  const when = new Date(version.captured_at).toLocaleString();
  const label = version.trigger_label ?? version.trigger_type.replace(/_/g, ' ');
  return `${when} — ${label}`;
}

function formatMoney(value: number): string {
  return value.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function SCurvePage() {
  const { user } = useAuth();
  const { projectId, setProjectId } = useSelectedProject();
  const [curveType, setCurveType] = useState<SCurveType>('pdm_based');
  const [reportingInterval, setReportingInterval] = useState<SCurveReportingInterval>('30_day');
  const [theoreticalTotalPeriods, setTheoreticalTotalPeriods] = useState(1);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [points, setPoints] = useState<SCurvePoint[]>([]);
  const [activities, setActivities] = useState<SCurveActivity[]>([]);
  const [costItems, setCostItems] = useState<SCurveCostItem[]>([]);
  const [periods, setPeriods] = useState<SCurvePeriodRow[]>([]);
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
  const [targetPlanPhp, setTargetPlanPhp] = useState<number | null>(null);
  const [actualPlanPercent, setActualPlanPercent] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  const [costSaving, setCostSaving] = useState(false);
  const [costDirty, setCostDirty] = useState(false);
  const [costMessage, setCostMessage] = useState('');
  const canEditCostItems = user?.role === 'contractor' || user?.role === 'engineer_1';
  const costSummary = useMemo(() => computeSCurveCostSummary(costItems), [costItems]);

  useEffect(() => {
    setViewingSnapshotId(null);
  }, [projectId]);

  useEffect(() => {
    setChartReady(true);
  }, []);

  const updateCostItem = (activityId: string, patch: Partial<Pick<SCurveCostItem, 'quantity' | 'unitCost'>>) => {
    setCostItems((current) =>
      current.map((item) => (item.activityId === activityId ? { ...item, ...patch } : item)),
    );
    setCostDirty(true);
    setCostMessage('');
  };

  const persistScheduleSettings = async (next: {
    curveType?: SCurveType;
    reportingInterval?: SCurveReportingInterval;
    theoreticalTotalPeriods?: number;
  }) => {
    if (viewingSnapshotId) return;
    const nextCurveType = next.curveType ?? curveType;
    const nextReportingInterval = next.reportingInterval ?? reportingInterval;
    const nextTheoreticalTotalPeriods = Math.max(
      1,
      next.theoreticalTotalPeriods ?? theoreticalTotalPeriods,
    );

    setSettingsSaving(true);
    try {
      const saved = await saveSCurveSettings({
        project_id: projectId,
        curve_type: nextCurveType,
        reporting_interval: nextReportingInterval,
        theoretical_total_periods: nextTheoreticalTotalPeriods,
      });
      setCurveType(saved.curve_type);
      setReportingInterval(saved.reporting_interval);
      setTheoreticalTotalPeriods(saved.theoretical_total_periods);
      setSettingsVersion((value) => value + 1);
    } finally {
      setSettingsSaving(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    getSCurve(projectId, viewingSnapshotId)
      .then((res) => {
        setPoints(res.points);
        setActivities(res.activities);
        setCostItems(res.cost_items ?? []);
        setPeriods(res.periods ?? []);
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
        setCurveType(res.curve_type);
        setReportingInterval(res.reporting_interval);
        setTheoreticalTotalPeriods(res.theoretical_total_periods);
        setTargetPlanPercent(res.target_plan_percent ?? null);
        setTargetPlanPhp(res.target_plan_php ?? null);
        setActualPlanPercent(res.actual_plan_percent ?? null);
        setCostDirty(false);
        setCostMessage('');
      })
      .catch(() => {
        setPoints([]);
        setActivities([]);
        setCostItems([]);
        setPeriods([]);
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
        setCurveType('pdm_based');
        setReportingInterval('30_day');
        setTheoreticalTotalPeriods(1);
        setTargetPlanPercent(null);
        setTargetPlanPhp(null);
        setActualPlanPercent(null);
        setCostDirty(false);
        setCostMessage('');
      })
      .finally(() => setLoading(false));
  }, [projectId, viewingSnapshotId, settingsVersion]);

  useEffect(() => {
    if (!canEditCostItems || !costDirty || viewingSnapshotId) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        setCostSaving(true);
        try {
          const res = await saveSCurveCostItems({
            project_id: projectId,
            items: costItems.map((item) => ({
              activityId: item.activityId,
              quantity: item.quantity,
              unitCost: item.unitCost,
            })),
          });
          setCostItems(res.cost_items);
          setCostDirty(false);
          setCostMessage('Cost items auto-saved.');
        } catch {
          setCostMessage('Could not save S-Curve cost items.');
        } finally {
          setCostSaving(false);
        }
      })();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [canEditCostItems, costDirty, costItems, projectId, viewingSnapshotId]);

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
          <div className="flex rounded-xl bg-surface-muted p-1">
            <button
              type="button"
              onClick={() => void persistScheduleSettings({ curveType: 'pdm_based' })}
              disabled={settingsSaving || !!viewingSnapshotId}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                curveType === 'pdm_based'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-text-muted'
              }`}
            >
              PDM-Based Target
            </button>
            <button
              type="button"
              onClick={() => void persistScheduleSettings({ curveType: 'ideal_theoretical' })}
              disabled={settingsSaving || !!viewingSnapshotId}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                curveType === 'ideal_theoretical'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-text-muted'
              }`}
            >
              Ideal/Theoretical
            </button>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-text">
            <span className="font-semibold text-text-muted">Interval</span>
            <select
              value={reportingInterval}
              disabled={settingsSaving || !!viewingSnapshotId}
              onChange={(e) =>
                void persistScheduleSettings({
                  reportingInterval: e.target.value as SCurveReportingInterval,
                })
              }
              className="bg-transparent text-sm font-semibold text-text outline-none"
            >
              <option value="10_day">10-Day Interval</option>
              <option value="30_day">30-Day / Monthly</option>
            </select>
          </label>
          {curveType === 'ideal_theoretical' && (
            <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-text">
              <span className="font-semibold text-text-muted">Theoretical periods</span>
              <input
                type="number"
                min={1}
                value={theoreticalTotalPeriods}
                disabled={settingsSaving || !!viewingSnapshotId}
                onChange={(e) => setTheoreticalTotalPeriods(Math.max(1, Number(e.target.value || 1)))}
                onBlur={(e) =>
                  void persistScheduleSettings({
                    theoreticalTotalPeriods: Math.max(1, Number(e.currentTarget.value || 1)),
                  })
                }
                className="w-20 bg-transparent text-sm font-semibold text-text outline-none"
              />
            </label>
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
                  periods,
                  status: scheduleStatus,
                  targetPlanPercent,
                  targetPlanPhp,
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
          ['Target plan', targetPlanPercent != null ? `${targetPlanPercent}%` : '—', `Current cumulative target from ${INTERVAL_LABELS[reportingInterval].toLowerCase()} grouping`, 'planned'],
          ['Target plan (PHP)', targetPlanPhp != null ? `P ${formatMoney(targetPlanPhp)}` : '—', 'Current cumulative target amount', 'reports'],
          ['Actual progress', actualPlanPercent != null ? `${actualPlanPercent}%` : '—', latestReportDate ? `Latest report ${latestReportDate}` : 'No approved report yet', 'actual'],
          ['Schedule variance', variance != null ? `${variance > 0 ? '+' : ''}${variance}%` : '—', variance == null ? 'Waiting for actual progress' : variance < 0 ? 'Behind target plan' : variance > 0 ? 'Ahead of target plan' : 'Matching target plan', 's-curve'],
          ['Critical path', criticalPath.length, syncedFromPdm ? 'Synced from PDM schedule' : 'Not synced from PDM', 'approval'],
          ['Total contract amount', `P ${formatMoney(costSummary.totalContractAmount)}`, 'Sum of all PDM-based item amounts', 'reports'],
          ['Total WT%', `${costSummary.totalWeightPct.toFixed(2)}%`, 'Should total 100% when items have amounts', 'projects'],
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

      {periods.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-text">
            {reportingInterval === '10_day'
              ? '10-day target accomplishment baseline'
              : 'Monthly target accomplishment baseline'}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {reportingInterval === '10_day'
              ? 'Each period uses a 10-day baseline. Target accomplishment comes from the WT% of PDM items scheduled within that period, and cumulative target builds sequentially.'
              : 'Each month uses a 30-day baseline. Target accomplishment comes from the WT% of PDM items scheduled within that period, and cumulative target builds sequentially.'}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-text-muted">
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Date range</th>
                  <th className="py-2 pr-3">Target %</th>
                  <th className="py-2 pr-3">Target (PHP)</th>
                  <th className="py-2 pr-3">Cumulative %</th>
                  <th className="py-2">Cumulative (PHP)</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.periodIndex} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-medium">{period.label}</td>
                    <td className="py-2 pr-3">
                      {period.startDate} to {period.endDate}
                    </td>
                    <td className="py-2 pr-3 font-semibold text-[#2563eb]">
                      {period.targetAccomplishmentPct.toFixed(2)}%
                    </td>
                    <td className="py-2 pr-3">P {formatMoney(period.targetAccomplishmentPhp)}</td>
                    <td className="py-2 pr-3 font-semibold text-primary">
                      {period.cumulativePct.toFixed(2)}%
                    </td>
                    <td className="py-2">P {formatMoney(period.cumulativePhp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                  <th className="py-2 pr-3">Target Plan (PHP)</th>
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
                    <td className="py-2 pr-3">P {formatMoney(row.target_php)}</td>
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
                          {row?.periodLabel && (
                            <p className="text-text-muted">{row.periodLabel}</p>
                          )}
                          {target != null && (
                            <p className="text-[#2563eb]">Target Plan: {target}%</p>
                          )}
                          {row?.targetAccomplishmentPct != null && (
                            <p className="text-text-muted">
                              Target this period: {row.targetAccomplishmentPct.toFixed(2)}%
                              {row.targetAccomplishmentPhp != null
                                ? ` · P ${formatMoney(row.targetAccomplishmentPhp)}`
                                : ''}
                            </p>
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
                    <td className="p-2 text-left font-semibold text-[#2563eb]">Cumulative target %</td>
                    {points.map((p) => (
                      <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                        {p.originalPlan != null ? `${p.originalPlan}%` : ''}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-border">
                    <td className="p-2 text-left font-semibold text-text-muted">Target this period %</td>
                    {points.map((p) => (
                      <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                        {p.targetAccomplishmentPct != null ? `${p.targetAccomplishmentPct.toFixed(2)}%` : ''}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-border">
                    <td className="p-2 text-left font-semibold text-text-muted">Target this period (PHP)</td>
                    {points.map((p) => (
                      <td key={p.pointDate ?? p.date} className="border-l border-border p-2">
                        {p.targetAccomplishmentPhp != null ? `P ${formatMoney(p.targetAccomplishmentPhp)}` : ''}
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

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-text">PDM-based target S-Curve items</h3>
            <p className="mt-1 text-sm text-text-muted">
              Item No. and Description stay synchronized with the PDM. Enter Qty and Unit Cost here
              to calculate Amount, Total Contract Amount, and WT%.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-text-muted">Total contract amount</p>
            <p className="text-lg font-semibold text-text">P {formatMoney(costSummary.totalContractAmount)}</p>
            <p className="text-xs text-text-muted">Total WT% {costSummary.totalWeightPct.toFixed(2)}%</p>
          </div>
        </div>

        {costMessage && (
          <p className={`mt-3 text-xs ${costMessage.includes('Could not') ? 'text-red-600' : 'text-text-muted'}`}>
            {costMessage}
          </p>
        )}
        {costSaving && <p className="mt-2 text-xs text-text-muted">Saving S-Curve cost items…</p>}
        {viewingSnapshotId && (
          <p className="mt-2 text-xs text-amber-700">
            Cost items are read-only while viewing an archived snapshot.
          </p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-text-muted">
                <th className="py-2 pr-3">Item No.</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">Qty</th>
                <th className="py-2 pr-3">Unit Cost (PHP)</th>
                <th className="py-2 pr-3">Amount (PHP)</th>
                <th className="py-2">WT%</th>
              </tr>
            </thead>
            <tbody>
              {costSummary.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-text-muted">
                    Add activities in the PDM schedule to populate the S-Curve item table.
                  </td>
                </tr>
              ) : (
                costSummary.items.map((item) => (
                  <tr key={item.activityId} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-medium">{item.itemNo || '—'}</td>
                    <td className="py-2 pr-3">{item.description || '—'}</td>
                    <td className="py-2 pr-3">
                      {canEditCostItems && !viewingSnapshotId ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.quantity || ''}
                          onChange={(e) =>
                            updateCostItem(item.activityId, {
                              quantity: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-28 rounded border border-border px-2 py-1 text-right"
                        />
                      ) : (
                        item.quantity
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {canEditCostItems && !viewingSnapshotId ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.unitCost || ''}
                          onChange={(e) =>
                            updateCostItem(item.activityId, {
                              unitCost: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-32 rounded border border-border px-2 py-1 text-right"
                        />
                      ) : (
                        `P ${formatMoney(item.unitCost)}`
                      )}
                    </td>
                    <td className="py-2 pr-3 font-medium">P {formatMoney(item.amount)}</td>
                    <td className="py-2">{item.weightPct.toFixed(2)}%</td>
                  </tr>
                ))
              )}
            </tbody>
            {costSummary.items.length > 0 && (
              <tfoot>
                <tr className="bg-surface-muted font-semibold text-text">
                  <td colSpan={4} className="py-2 pr-3 text-right">
                    Total Contract Amount
                  </td>
                  <td className="py-2 pr-3">P {formatMoney(costSummary.totalContractAmount)}</td>
                  <td className="py-2">{costSummary.totalWeightPct.toFixed(2)}%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
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
            Each row is one PDM activity. Planned % is the cumulative target at the end of the
            selected reporting period where that activity is scheduled to finish. PDM start, end,
            and duration stay unchanged.
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
                  <th className="py-2 pr-3">Cumulative target %</th>
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
