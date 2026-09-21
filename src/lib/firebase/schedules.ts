import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { BarChartTask, PdmActivity, PdmDependency } from '../../types';
import type { ReportProgressEntry } from '../../components/ReportProgressFeed';
import { applyPdmDerivatives, applyReportProgressToBarChart } from '../scheduleSync';
import { resolveTargetAndActual, compareTargetVsActual } from '../progressStatus';
import type { ScheduleStatus } from '../sCurveApi';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { asId, nowIso } from './ids';
import { listApprovedProgressForProject } from './reportProgress';
import { getProjectFs } from './projects';

export interface ProjectScheduleDoc {
  project_id: string;
  activities: PdmActivity[];
  dependencies: PdmDependency[];
  barChartTasks: BarChartTask[];
  barChartTotalDays: number;
  barChartTimeNow: number;
  projectDuration: number;
  criticalPath: string[];
  pdmError?: string | null;
  reportFeed?: ReportProgressEntry[];
  latestReportPercent?: number | null;
  latestReportDate?: string | null;
  targetPlanPercent?: number | null;
  actualPlanPercent?: number | null;
  progressStatus?: ScheduleStatus | null;
}

const EMPTY = (projectId: string): ProjectScheduleDoc => ({
  project_id: projectId,
  activities: [],
  dependencies: [],
  barChartTasks: [],
  barChartTotalDays: 1,
  barChartTimeNow: 0,
  projectDuration: 0,
  criticalPath: [],
  pdmError: null,
  reportFeed: [],
  latestReportPercent: null,
  latestReportDate: null,
  targetPlanPercent: null,
  actualPlanPercent: null,
  progressStatus: null,
});

async function withReportProgress(schedule: ProjectScheduleDoc): Promise<ProjectScheduleDoc> {
  const feed = await listApprovedProgressForProject(schedule.project_id);
  const { targetPct, actualPct } = resolveTargetAndActual(feed);
  const progressStatus = compareTargetVsActual(targetPct, actualPct);

  let projectStart = nowIso().slice(0, 10);
  try {
    const { project } = await getProjectFs(schedule.project_id);
    if (project.start_date) projectStart = project.start_date;
  } catch {
    /* use today */
  }

  const totalDays = Math.max(1, schedule.barChartTotalDays || schedule.projectDuration || 1);
  const applied = applyReportProgressToBarChart(
    schedule.barChartTasks,
    feed,
    projectStart,
    totalDays,
  );

  return {
    ...schedule,
    barChartTasks: applied.tasks,
    barChartTimeNow: applied.timeNow,
    reportFeed: feed,
    latestReportPercent: applied.latestPercent ?? actualPct ?? targetPct,
    latestReportDate: applied.latestReportDate,
    targetPlanPercent: targetPct,
    actualPlanPercent: actualPct,
    progressStatus,
  };
}

export async function getScheduleFs(projectId: string | number): Promise<ProjectScheduleDoc> {
  const id = asId(projectId);
  const snap = await getDoc(doc(db, COLLECTIONS.schedules, id));
  if (!snap.exists()) {
    return withReportProgress(EMPTY(id));
  }
  const data = snap.data() as Record<string, unknown>;
  const raw: ProjectScheduleDoc = {
    project_id: id,
    activities: (data.activities as PdmActivity[]) ?? [],
    dependencies: (data.dependencies as PdmDependency[]) ?? [],
    barChartTasks: (data.barChartTasks as BarChartTask[]) ?? [],
    barChartTotalDays: Number(data.barChartTotalDays ?? 1),
    barChartTimeNow: Number(data.barChartTimeNow ?? 0),
    projectDuration: Number(data.projectDuration ?? 0),
    criticalPath: (data.criticalPath as string[]) ?? [],
    pdmError: (data.pdmError as string | null) ?? null,
  };
  return withReportProgress(applyPdmDerivatives(raw));
}

export async function saveScheduleFs(payload: {
  project_id: string | number;
  activities: PdmActivity[];
  dependencies: PdmDependency[];
  barChartTimeNow?: number;
  barChartTasks?: BarChartTask[];
  barChartTotalDays?: number;
}): Promise<ProjectScheduleDoc> {
  const id = asId(payload.project_id);
  const derived = applyPdmDerivatives({
    project_id: id,
    activities: payload.activities,
    dependencies: payload.dependencies,
    barChartTasks: payload.barChartTasks ?? [],
    barChartTotalDays: payload.barChartTotalDays ?? 1,
    barChartTimeNow: payload.barChartTimeNow ?? 0,
    projectDuration: 0,
    criticalPath: [],
  });
  await setDoc(
    doc(db, COLLECTIONS.schedules, id),
    {
      ...derived,
      projectId: id,
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  return withReportProgress(derived);
}

export async function clearScheduleFs(projectId: string | number): Promise<ProjectScheduleDoc> {
  const id = asId(projectId);
  const empty = EMPTY(id);
  await setDoc(doc(db, COLLECTIONS.schedules, id), {
    ...empty,
    projectId: id,
    updatedAt: nowIso(),
  });
  return withReportProgress(empty);
}

export async function loadReferenceScheduleFs(
  projectId: string | number,
): Promise<ProjectScheduleDoc> {
  return getScheduleFs(projectId);
}
