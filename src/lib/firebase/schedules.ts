import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { BarChartTask, PdmActivity, PdmDependency } from '../../types';
import { applyPdmDerivatives } from '../scheduleSync';
import { canEditProjectCharts } from '../chartPermissions';
import { COLLECTIONS, scheduleVersionsPath } from './collections';
import { db } from './config';
import { asId, nowIso, omitUndefinedDeep } from './ids';
import { getAccessContext } from './access';
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

async function assertCanEditProjectCharts() {
  const access = await getAccessContext();
  if (!canEditProjectCharts(access?.role)) {
    throw new Error('You have view-only access to PDM / S-Curve / Bar Chart for this project.');
  }
}

/** Rebuild activity docs with only schema-safe values (never `undefined`). */
function sanitizeActivityForFs(a: PdmActivity): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: String(a.id ?? ''),
    number: String(a.number ?? ''),
    name: String(a.name ?? ''),
    duration: Number.isFinite(Number(a.duration)) ? Number(a.duration) : 0,
  };
  if (a.payItemId) out.payItemId = String(a.payItemId);
  if (a.payItemVersion != null && Number.isFinite(Number(a.payItemVersion))) {
    out.payItemVersion = Number(a.payItemVersion);
  }
  if (a.unit != null && a.unit !== '') out.unit = String(a.unit);
  if (a.esOverride != null && Number.isFinite(Number(a.esOverride))) {
    out.esOverride = Number(a.esOverride);
  }
  if (a.extendToEnd === true) out.extendToEnd = true;
  if (a.extendToEnd === false) out.extendToEnd = false;
  if (a.es != null && Number.isFinite(Number(a.es))) out.es = Number(a.es);
  if (a.ef != null && Number.isFinite(Number(a.ef))) out.ef = Number(a.ef);
  if (a.ls != null && Number.isFinite(Number(a.ls))) out.ls = Number(a.ls);
  if (a.lf != null && Number.isFinite(Number(a.lf))) out.lf = Number(a.lf);
  if (a.isCritical === true || a.isCritical === false) out.isCritical = a.isCritical;
  if (a.posX != null && Number.isFinite(Number(a.posX))) out.posX = Number(a.posX);
  if (a.posY != null && Number.isFinite(Number(a.posY))) out.posY = Number(a.posY);
  return out;
}

function sanitizeDependencyForFs(d: PdmDependency): Record<string, unknown> {
  return {
    id: String(d.id ?? ''),
    fromId: String(d.fromId ?? ''),
    toId: String(d.toId ?? ''),
    type: d.type ?? 'FS',
    lag: Number.isFinite(Number(d.lag)) ? Number(d.lag) : 0,
  };
}

function sanitizeBarTaskForFs(t: BarChartTask): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: String(t.id ?? ''),
    index: Number.isFinite(Number(t.index)) ? Number(t.index) : 0,
    name: String(t.name ?? ''),
    startDay: Number.isFinite(Number(t.startDay)) ? Number(t.startDay) : 0,
    endDay: Number.isFinite(Number(t.endDay)) ? Number(t.endDay) : 0,
    // null = no actual progress tracked (Firestore rejects undefined)
    actualEndDay:
      t.actualEndDay != null && Number.isFinite(Number(t.actualEndDay))
        ? Number(t.actualEndDay)
        : null,
  };
  if (t.isCritical === true || t.isCritical === false) out.isCritical = t.isCritical;
  return out;
}

function scheduleDocForFs(
  derived: ProjectScheduleDoc,
  projectId: string,
): Record<string, unknown> {
  return omitUndefinedDeep({
    project_id: projectId,
    projectId,
    activities: derived.activities.map(sanitizeActivityForFs),
    dependencies: derived.dependencies.map(sanitizeDependencyForFs),
    barChartTasks: derived.barChartTasks.map(sanitizeBarTaskForFs),
    barChartTotalDays: Math.max(1, Number(derived.barChartTotalDays) || 1),
    barChartTimeNow: Number.isFinite(Number(derived.barChartTimeNow))
      ? Number(derived.barChartTimeNow)
      : 0,
    projectDuration: Number.isFinite(Number(derived.projectDuration))
      ? Number(derived.projectDuration)
      : 0,
    criticalPath: Array.isArray(derived.criticalPath)
      ? derived.criticalPath.map(String)
      : [],
    pdmError: derived.pdmError ?? null,
    updatedAt: nowIso(),
  });
}

export const ORIGINAL_SCHEDULE_VERSION_ID = 'original';
export const CURRENT_SCHEDULE_VERSION_ID = 'current';
export const ORIGINAL_SCHEDULE_LABEL = 'Original Schedule';
export const SUSPENDED_CURRENT_SCHEDULE_LABEL =
  'New/Current Schedule for Suspended Project';

export interface ProjectScheduleVersions {
  hasOriginal: boolean;
  activeVersionId: string | null;
  activeLabel: string | null;
  originalLabel: string | null;
}

interface ScheduleVersionMeta {
  activeVersionId: string | null;
  originalVersionId: string | null;
  versionKind: string | null;
  versionLabel: string | null;
}

function versionMetaFromData(data: Record<string, unknown> | undefined): ScheduleVersionMeta | null {
  if (!data?.activeVersionId) return null;
  return {
    activeVersionId: String(data.activeVersionId),
    originalVersionId: data.originalVersionId != null ? String(data.originalVersionId) : null,
    versionKind: data.versionKind != null ? String(data.versionKind) : null,
    versionLabel: data.versionLabel != null ? String(data.versionLabel) : null,
  };
}

async function readScheduleVersionMeta(projectId: string): Promise<ScheduleVersionMeta | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.schedules, projectId));
  if (!snap.exists()) return null;
  return versionMetaFromData(snap.data() as Record<string, unknown>);
}

function withVersionMeta(
  body: Record<string, unknown>,
  meta: ScheduleVersionMeta | null,
): Record<string, unknown> {
  if (!meta?.activeVersionId) return body;
  return {
    ...body,
    activeVersionId: meta.activeVersionId,
    originalVersionId: meta.originalVersionId,
    versionKind: meta.versionKind,
    versionLabel: meta.versionLabel,
    frozen: false,
  };
}

async function mirrorCurrentVersion(projectId: string, body: Record<string, unknown>) {
  if (body.activeVersionId !== CURRENT_SCHEDULE_VERSION_ID) return;
  await setDoc(doc(db, scheduleVersionsPath(projectId), CURRENT_SCHEDULE_VERSION_ID), body, {
    merge: true,
  });
}

/**
 * Activity rows on the schedule document only.
 * SWA item numbers must not load S-curve, bar chart, or the project report feed.
 */
export async function listScheduleActivitiesFs(
  projectId: string | number,
): Promise<PdmActivity[]> {
  const id = asId(projectId);
  if (!id) return [];
  const snap = await getDoc(doc(db, COLLECTIONS.schedules, id));
  if (!snap.exists()) return [];
  const data = snap.data() as Record<string, unknown>;
  return (data.activities as PdmActivity[]) ?? [];
}

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
  await assertCanEditProjectCharts();
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
  const meta = await readScheduleVersionMeta(id);
  const body = withVersionMeta(scheduleDocForFs(derived, id), meta);
  await setDoc(doc(db, COLLECTIONS.schedules, id), body, {
    merge: true,
  });
  await mirrorCurrentVersion(id, body);
  invalidateChartCaches(id);
  const ctx = await loadProjectChartContext(id);
  return ctx.schedule;
}

export async function clearScheduleFs(projectId: string | number): Promise<ProjectScheduleDoc> {
  await assertCanEditProjectCharts();
  const id = asId(projectId);
  const empty = EMPTY_SCHEDULE(id);
  const meta = await readScheduleVersionMeta(id);
  const body = withVersionMeta(scheduleDocForFs(empty, id), meta);
  await setDoc(doc(db, COLLECTIONS.schedules, id), body, { merge: true });
  await mirrorCurrentVersion(id, body);
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

export async function getProjectScheduleVersionsFs(
  projectId: string | number,
): Promise<ProjectScheduleVersions> {
  const id = asId(projectId);
  const [liveSnap, originalSnap] = await Promise.all([
    getDoc(doc(db, COLLECTIONS.schedules, id)),
    getDoc(doc(db, scheduleVersionsPath(id), ORIGINAL_SCHEDULE_VERSION_ID)),
  ]);
  const meta = liveSnap.exists()
    ? versionMetaFromData(liveSnap.data() as Record<string, unknown>)
    : null;
  return {
    hasOriginal: originalSnap.exists(),
    activeVersionId: meta?.activeVersionId ?? null,
    activeLabel: meta?.versionLabel ?? null,
    originalLabel: originalSnap.exists()
      ? String((originalSnap.data() as Record<string, unknown>).versionLabel ?? ORIGINAL_SCHEDULE_LABEL)
      : null,
  };
}

function scheduleFromVersionData(projectId: string, data: Record<string, unknown>): ProjectScheduleDoc {
  return applyPdmDerivatives({
    project_id: projectId,
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

/** Read a stored schedule version. `current` is the live active schedule. */
export async function getScheduleVersionFs(
  projectId: string | number,
  versionId: string,
): Promise<ProjectScheduleDoc> {
  const id = asId(projectId);
  if (versionId === CURRENT_SCHEDULE_VERSION_ID) return getScheduleFs(id);
  const snap = await getDoc(doc(db, scheduleVersionsPath(id), versionId));
  if (!snap.exists()) return EMPTY_SCHEDULE(id);
  return scheduleFromVersionData(id, snap.data() as Record<string, unknown>);
}

/**
 * Snapshot the live schedule as Original, then start an empty current schedule
 * on the same project. Does not create a project. A second call does not wipe
 * the current schedule or the frozen original.
 */
export async function createSuspendedProjectScheduleFs(projectId: string | number): Promise<{
  alreadyExisted: boolean;
  schedule: ProjectScheduleDoc;
}> {
  const access = await getAccessContext();
  if (access?.role !== 'contractor') {
    throw new Error('Only the contractor can create a schedule for a suspended project.');
  }
  const id = asId(projectId);
  const project = await getProjectFs(id);
  if (String(project.project.status ?? '') !== 'suspended') {
    throw new Error('Select a project marked Suspended.');
  }

  const liveRef = doc(db, COLLECTIONS.schedules, id);
  const originalRef = doc(db, scheduleVersionsPath(id), ORIGINAL_SCHEDULE_VERSION_ID);
  const currentRef = doc(db, scheduleVersionsPath(id), CURRENT_SCHEDULE_VERSION_ID);
  const [liveSnap, originalSnap, currentSnap] = await Promise.all([
    getDoc(liveRef),
    getDoc(originalRef),
    getDoc(currentRef),
  ]);

  if (!originalSnap.exists()) {
    const source = liveSnap.exists()
      ? (liveSnap.data() as Record<string, unknown>)
      : scheduleDocForFs(EMPTY_SCHEDULE(id), id);
    await setDoc(originalRef, {
      ...source,
      projectId: id,
      versionKind: 'original',
      versionLabel: ORIGINAL_SCHEDULE_LABEL,
      frozen: true,
      createdAt: nowIso(),
    });
  }

  const alreadyExisted =
    currentSnap.exists() ||
    (liveSnap.exists() &&
      String((liveSnap.data() as Record<string, unknown>).activeVersionId ?? '') ===
        CURRENT_SCHEDULE_VERSION_ID);

  if (!alreadyExisted) {
    const body = {
      ...scheduleDocForFs(EMPTY_SCHEDULE(id), id),
      activeVersionId: CURRENT_SCHEDULE_VERSION_ID,
      originalVersionId: ORIGINAL_SCHEDULE_VERSION_ID,
      versionKind: 'suspended',
      versionLabel: SUSPENDED_CURRENT_SCHEDULE_LABEL,
      frozen: false,
      createdAt: nowIso(),
    };
    await setDoc(liveRef, body, { merge: true });
    await setDoc(currentRef, body);
  }

  invalidateChartCaches(id);
  return { alreadyExisted, schedule: await getScheduleFs(id) };
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
