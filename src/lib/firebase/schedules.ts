import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { BarChartTask, PdmActivity, PdmDependency } from '../../types';
import { applyPdmDerivatives } from '../scheduleSync';
import { COLLECTIONS } from './collections';
import { db } from './config';
import { asId, nowIso } from './ids';
import {
  applyFeedToSchedule,
  EMPTY_SCHEDULE,
  getBarChartFs,
  invalidateChartCaches,
  loadProjectChartContext,
  type ProjectScheduleDoc,
} from './chartContext';
import { listApprovedProgressForProject } from './reportProgress';
import { getProjectFs } from './projects';

export type { ProjectScheduleDoc };
export { getBarChartFs };

export async function getScheduleFs(projectId: string | number): Promise<ProjectScheduleDoc> {
  const id = asId(projectId);
  try {
    // Prefer shared context (deduped with S-curve / bar chart loads).
    const ctx = await loadProjectChartContext(id);
    return ctx.schedule;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/permission|insufficient/i.test(message)) {
      try {
        const feed = await listApprovedProgressForProject(id).catch(() => []);
        let projectStart = nowIso().slice(0, 10);
        try {
          const { project } = await getProjectFs(id);
          if (project.start_date) projectStart = project.start_date;
        } catch {
          /* ignore */
        }
        return applyFeedToSchedule(EMPTY_SCHEDULE(id), feed, projectStart);
      } catch {
        return EMPTY_SCHEDULE(id);
      }
    }
    throw err;
  }
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
  invalidateChartCaches(id);
  const ctx = await loadProjectChartContext(id);
  return ctx.schedule;
}

export async function clearScheduleFs(projectId: string | number): Promise<ProjectScheduleDoc> {
  const id = asId(projectId);
  const empty = EMPTY_SCHEDULE(id);
  await setDoc(doc(db, COLLECTIONS.schedules, id), {
    ...empty,
    projectId: id,
    updatedAt: nowIso(),
  });
  invalidateChartCaches(id);
  return getScheduleFs(id);
}

export async function loadReferenceScheduleFs(
  projectId: string | number,
): Promise<ProjectScheduleDoc> {
  const { buildRoadPdmSample } = await import('../../data/roadPdmSample');
  const id = asId(projectId);
  const sample = buildRoadPdmSample();
  return saveScheduleFs({
    project_id: id,
    activities: sample.activities,
    dependencies: sample.dependencies,
  });
}

/** @deprecated — prefer loadProjectChartContext; kept for direct schedule doc reads. */
export async function readRawScheduleDoc(projectId: string | number) {
  const id = asId(projectId);
  const snap = await getDoc(doc(db, COLLECTIONS.schedules, id));
  if (!snap.exists()) return EMPTY_SCHEDULE(id);
  const data = snap.data() as Record<string, unknown>;
  return applyPdmDerivatives({
    project_id: id,
    activities: (data.activities as PdmActivity[]) ?? [],
    dependencies: (data.dependencies as PdmDependency[]) ?? [],
    barChartTasks: (data.barChartTasks as BarChartTask[]) ?? [],
    barChartTotalDays: Number(data.barChartTotalDays ?? 1),
    barChartTimeNow: Number(data.barChartTimeNow ?? 0),
    projectDuration: Number(data.projectDuration ?? 0),
    criticalPath: (data.criticalPath as string[]) ?? [],
    pdmError: (data.pdmError as string | null) ?? null,
  });
}
