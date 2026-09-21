'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/nextRouter';
import { useAuth } from '../context/AuthContext';
import { useSelectedProject } from '../context/SelectedProjectContext';
import { ProjectSelect } from '../components/ProjectSelect';
import { DocumentsBackLink } from '../components/DocumentsBackLink';
import { ReportProgressFeed, type ReportProgressEntry } from '../components/ReportProgressFeed';
import { NavIcon, type NavIconName } from '../components/NavIcon';
import { getSchedule } from '../lib/scheduleApi';
import type { BarChartTask } from '../types';
import { exportBarChartPdf } from '../lib/chartPdfExport';
import type { ScheduleStatus } from '../lib/sCurveApi';

function getScheduleStatus(
  plannedEnd: number,
  actualEnd: number | null | undefined,
  timeNow: number,
): 'ahead' | 'on' | 'behind' | 'planned' {
  // No reports yet → Target Plan only. Delay / ahead / on-schedule starts after
  // SWA, STEWA, or IAR actual % is recorded.
  if (timeNow < 1 || actualEnd == null) return 'planned';
  if (actualEnd < timeNow && plannedEnd >= timeNow) return 'behind';
  if (actualEnd > plannedEnd) return 'behind';
  if (actualEnd < plannedEnd) return 'ahead';
  if (actualEnd === timeNow || actualEnd === plannedEnd) return 'on';
  return 'on';
}

const STATUS_COLORS = {
  ahead: 'bg-primary',
  on: 'bg-amber-500',
  behind: 'bg-red-500',
  /** Target plan — used when schedule is first entered (no actual progress yet). */
  planned: 'bg-blue-600',
};

function buildWeeks(totalDays: number) {
  const weeks: { label: string; start: number; end: number }[] = [];
  let day = 1;
  let week = 1;
  while (day <= totalDays) {
    const end = Math.min(day + 4, totalDays);
    weeks.push({ label: `Week ${week}`, start: day, end });
    day = end + 1;
    week += 1;
  }
  return weeks;
}

export function BarChartPage() {
  const { user } = useAuth();
  const { projectId, setProjectId } = useSelectedProject();
  const [tasks, setTasks] = useState<BarChartTask[]>([]);
  const [totalDays, setTotalDays] = useState(24);
  const [timeNow, setTimeNow] = useState(10);
  const [reportFeed, setReportFeed] = useState<ReportProgressEntry[]>([]);
  const [latestReportPercent, setLatestReportPercent] = useState<number | null>(null);
  const [latestReportDate, setLatestReportDate] = useState<string | null>(null);
  const [targetPlanPercent, setTargetPlanPercent] = useState<number | null>(null);
  const [actualPlanPercent, setActualPlanPercent] = useState<number | null>(null);
  const [progressStatus, setProgressStatus] = useState<ScheduleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getSchedule(projectId);
        if (!cancelled) {
          setTasks(data.barChartTasks);
          setTotalDays(data.barChartTotalDays);
          setTimeNow(data.barChartTimeNow);
          setReportFeed(data.reportFeed ?? []);
          setLatestReportPercent(data.latestReportPercent ?? null);
          setLatestReportDate(data.latestReportDate ?? null);
          setTargetPlanPercent(data.targetPlanPercent ?? null);
          setActualPlanPercent(data.actualPlanPercent ?? null);
          setProgressStatus(data.progressStatus ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load bar chart from database.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => i + 1),
    [totalDays],
  );
  const weeks = useMemo(() => buildWeeks(totalDays), [totalDays]);
  const hasReportActuals = timeNow >= 1 && latestReportPercent != null;
  const behindTaskCount = tasks.filter(
    (task) => getScheduleStatus(task.endDay, hasReportActuals ? task.actualEndDay : null, timeNow) === 'behind',
  ).length;
  const criticalTaskCount = tasks.filter((task) => task.isCritical).length;
  const plannedTaskCount = tasks.filter((task) => !task.actualEndDay).length;
  const latestProgressLabel = latestReportPercent != null ? `${latestReportPercent}%` : 'Not reported';

  return (
    <main className="flex-1 overflow-y-auto">
      <DocumentsBackLink />
      <div className="space-y-6 px-8 pb-10 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-block rounded-full bg-primary-light px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
            Schedule workspace
          </span>
          <h1 className="mt-3 font-serif text-3xl text-text">Bar chart schedule</h1>
          <p className="mt-2 max-w-3xl text-sm text-text-muted">
            Compare the target plan with reported progress and quickly identify critical or delayed work.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {progressStatus && (
            <div
              className={`rounded-xl px-4 py-2 text-right text-sm ${
                progressStatus.status === 'ahead'
                  ? 'bg-emerald-50 text-emerald-800'
                  : progressStatus.status === 'behind'
                    ? 'bg-red-50 text-red-800'
                    : progressStatus.status === 'on_schedule'
                      ? 'bg-primary-light text-primary'
                      : 'bg-blue-50 text-blue-800'
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wide">Schedule health</p>
              <p className="font-semibold">{progressStatus.label}</p>
              {progressStatus.planned_pct != null && (
                <p className="text-xs opacity-80">
                  Target {progressStatus.planned_pct}%
                  {progressStatus.actual_pct != null
                    ? ` · Actual ${progressStatus.actual_pct}%`
                    : ''}
                </p>
              )}
            </div>
          )}
          <ProjectSelect value={projectId} onChange={setProjectId} className="min-w-[240px]" />
          <button
            type="button"
            disabled={exporting || tasks.length === 0}
            onClick={() => {
              setExporting(true);
              try {
                exportBarChartPdf({
                  projectLabel: `Project ${projectId}`,
                  tasks,
                  totalDays,
                  timeNow,
                  status: progressStatus,
                  targetPlanPercent,
                  actualPlanPercent,
                });
              } finally {
                setExporting(false);
              }
            }}
              className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-text transition hover:bg-surface-muted disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export Bar Chart PDF'}
          </button>
          {user?.role === 'contractor' && (
            <Link
              to="/schedule"
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
            >
              Prepare schedule
            </Link>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ['Schedule duration', `${totalDays} days`, 'Total planned timeline', 'schedule'],
          ['Activities', tasks.length, `${plannedTaskCount} awaiting actual progress · ${behindTaskCount} delayed`, 'projects'],
          ['Critical tasks', criticalTaskCount, 'Zero-float activities', 'approval'],
          ['Latest progress', latestProgressLabel, latestReportDate ? `Reported ${latestReportDate}` : 'No approved report yet', 'reports'],
        ] as [string, string | number, string, NavIconName][]).map(([label, value, caption, icon]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-light text-primary">
                <NavIcon name={icon} className="h-5 w-5" />
              </span>
            </div>
            <p className={`mt-3 text-2xl font-semibold ${label === 'Critical tasks' && criticalTaskCount > 0 ? 'text-red-600' : 'text-text'}`}>{value}</p>
            <p className="mt-1 truncate text-xs text-text-muted" title={caption}>{caption}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 text-sm shadow-sm">
        <p className="mr-2 font-semibold text-text">Chart legend</p>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded bg-red-500" /> Behind
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded bg-amber-500" /> On Track
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded bg-primary" /> Ahead
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded bg-blue-600" /> Target Plan (first SWA/STEWA)
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded border-2 border-red-600 bg-blue-600" /> Critical path
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-8 w-3 rounded bg-amber-200 ring-1 ring-amber-500" /> Time Now (latest report)
        </span>
      </div>

      <ReportProgressFeed
        reports={reportFeed}
        latestPercent={latestReportPercent}
        latestDate={latestReportDate}
      />

      {loading ? (
        <div className="h-80 animate-pulse rounded-2xl border border-border bg-card" />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-text">Construction timeline</h2>
              <p className="mt-1 text-sm text-text-muted">Target plan, actual progress, and the current reporting day.</p>
            </div>
            <div className="text-right text-xs text-text-muted">
              <p>{weeks.length} planning weeks</p>
              {hasReportActuals && <p className="mt-1 font-semibold text-amber-700">Time now: Day {timeNow}</p>}
            </div>
          </div>
          <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="w-8 p-2 text-left">#</th>
                <th className="min-w-[200px] p-2 text-left">Task</th>
                {weeks.map((w) => (
                  <th
                    key={w.label}
                    colSpan={w.end - w.start + 1}
                    className="border-l border-border p-2 text-center"
                  >
                    {w.label}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border bg-surface/80">
                <th colSpan={2} />
                {days.map((d) => (
                  <th
                    key={d}
                    className={`w-7 border-l border-border/50 p-1 text-center font-normal ${
                      hasReportActuals && d === timeNow
                        ? 'bg-amber-100 font-semibold text-amber-900 ring-1 ring-inset ring-amber-400'
                        : 'text-text-muted'
                    }`}
                  >
                    {d}
                    {hasReportActuals && d === timeNow ? (
                      <span className="block text-[8px] font-bold uppercase">Now</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const hasActual = hasReportActuals && task.actualEndDay != null;
                const status = getScheduleStatus(
                  task.endDay,
                  hasReportActuals ? task.actualEndDay : null,
                  timeNow,
                );
                const plannedSpan = Math.max(0, task.endDay - task.startDay + 1);
                const critical = !!task.isCritical;
                return (
                  <tr
                    key={task.id}
                    className={`border-b border-border/50 ${critical ? 'bg-red-50/60' : ''}`}
                  >
                    <td className="p-2 text-text-muted">{task.index}</td>
                    <td className={`p-2 font-medium ${critical ? 'text-red-700' : 'text-text'}`}>
                      {task.name}
                      {critical ? (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-red-600">
                          Critical
                        </span>
                      ) : null}
                    </td>
                    {days.map((d) => {
                      const inPlanned = d >= task.startDay && d <= task.endDay;
                      const isBarStart = d === task.startDay;

                      if (!inPlanned) {
                        return (
                          <td
                            key={d}
                            className={`h-10 min-w-[1.75rem] border-l border-border/30 bg-card ${
                              hasReportActuals && d === timeNow ? 'bg-amber-50/80' : ''
                            }`}
                          />
                        );
                      }

                      if (isBarStart && plannedSpan > 0) {
                        return (
                          <td
                            key={d}
                            colSpan={plannedSpan}
                            className={`relative h-10 border-l border-border/30 bg-card p-1 align-middle ${
                              hasReportActuals && timeNow >= task.startDay && timeNow <= task.endDay
                                ? 'bg-amber-50/40'
                                : ''
                            }`}
                          >
                            <div
                              className={`h-4 w-full rounded-sm ${
                                hasActual ? STATUS_COLORS[status] : STATUS_COLORS.planned
                              } ${critical ? 'ring-2 ring-red-600 ring-offset-1' : ''}`}
                              title={`Days ${task.startDay}–${task.endDay}${
                                hasActual ? ` · actual end ${task.actualEndDay}` : ' · Target Plan'
                              }${critical ? ' · Critical path' : ''}`}
                            />
                          </td>
                        );
                      }

                      return null;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
