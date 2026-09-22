import { calculatePdmSchedule, getCriticalPath } from './pdm';
import type { BarChartTask, PdmActivity, PdmDependency } from '../types';
import type { ReportProgressEntry } from '../components/ReportProgressFeed';
import { swaStewaChronological } from './progressStatus';

export function deriveBarChartFromPdm(
  activities: PdmActivity[],
  dependencies: PdmDependency[],
  existingTasks: BarChartTask[] = [],
): {
  activities: PdmActivity[];
  barChartTasks: BarChartTask[];
  projectDuration: number;
  criticalPath: string[];
  pdmError: string | null;
} {
  if (activities.length === 0) {
    return {
      activities: [],
      barChartTasks: [],
      projectDuration: 0,
      criticalPath: [],
      pdmError: null,
    };
  }

  const scheduled = calculatePdmSchedule(activities, dependencies);
  if (scheduled.length !== activities.length) {
    return {
      activities,
      barChartTasks: existingTasks,
      projectDuration: 0,
      criticalPath: [],
      pdmError: 'Circular dependency detected',
    };
  }

  const actualByName = new Map(
    existingTasks.filter((t) => t.actualEndDay != null).map((t) => [t.name, t.actualEndDay]),
  );

  const barChartTasks: BarChartTask[] = scheduled.map((a, i) => ({
    id: existingTasks.find((t) => t.name === a.name)?.id ?? `derived-${a.id}`,
    index: i + 1,
    name: a.name,
    startDay: (a.es ?? 0) + 1,
    endDay: Math.max(a.es ?? 0, a.ef ?? a.duration),
    actualEndDay: actualByName.get(a.name),
    isCritical: !!a.isCritical,
  }));

  const projectDuration = Math.max(...scheduled.map((a) => a.ef ?? 0), 0);

  return {
    activities: scheduled,
    barChartTasks,
    projectDuration,
    criticalPath: getCriticalPath(scheduled, dependencies).map((a) => a.number),
    pdmError: null,
  };
}

export function applyPdmDerivatives<T extends {
  activities: PdmActivity[];
  dependencies: PdmDependency[];
  barChartTasks: BarChartTask[];
  barChartTotalDays: number;
  projectDuration: number;
  criticalPath: string[];
  pdmError?: string | null;
}>(schedule: T): T {
  const derived = deriveBarChartFromPdm(
    schedule.activities,
    schedule.dependencies,
    schedule.barChartTasks,
  );
  return {
    ...schedule,
    activities: derived.activities,
    barChartTasks: derived.barChartTasks,
    barChartTotalDays: Math.max(1, derived.projectDuration),
    projectDuration: derived.projectDuration,
    criticalPath: derived.criticalPath,
    pdmError: derived.pdmError,
  };
}

/**
 * Map latest SWA/STEWA Actual Plan % onto bar-chart tasks (PHP ScheduleSync port).
 * Clears actuals when there is no Actual Plan yet (Target Plan only).
 */
export function applyReportProgressToBarChart(
  barChartTasks: BarChartTask[],
  reportFeed: ReportProgressEntry[],
  projectStartDate: string,
  totalDays: number,
): {
  tasks: BarChartTask[];
  timeNow: number;
  latestPercent: number | null;
  latestReportDate: string | null;
} {
  const chrono = swaStewaChronological(reportFeed);
  const tasks = barChartTasks.map((t) => ({ ...t, actualEndDay: null as number | null }));

  if (chrono.length < 2) {
    return {
      tasks,
      timeNow: 0,
      latestPercent: null,
      latestReportDate: null,
    };
  }

  const latest = chrono[chrono.length - 1];
  const startTs = Date.parse(`${projectStartDate}T00:00:00Z`) || Date.now();
  const latestTs = Date.parse(`${latest.date}T00:00:00Z`) || startTs;
  const elapsed = Math.floor((latestTs - startTs) / 86400000) + 1;
  const timeNow = Math.min(Math.max(1, elapsed), Math.max(1, totalDays));
  const achievedDays = Math.round((latest.percent / 100) * Math.max(1, totalDays));

  for (const task of tasks) {
    if (task.endDay <= achievedDays) {
      task.actualEndDay = task.endDay;
    }
  }

  return {
    tasks,
    timeNow,
    latestPercent: latest.percent,
    latestReportDate: latest.date,
  };
}
