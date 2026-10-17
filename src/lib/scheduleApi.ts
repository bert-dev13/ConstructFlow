import type { BarChartTask, PdmActivity, PdmDependency } from '../types';
import type { ReportProgressEntry } from '../components/ReportProgressFeed';
import {
  clearScheduleFs,
  createSuspendedProjectScheduleFs,
  getBarChartFs,
  getProjectScheduleVersionsFs,
  getScheduleFs,
  listScheduleActivitiesFs,
  getScheduleVersionFs,
  loadReferenceScheduleFs,
  saveScheduleFs,
  type ProjectScheduleDoc,
  type ProjectScheduleVersions,
} from './firebase/schedules';

export type ProjectSchedule = ProjectScheduleDoc;

export function getSchedule(projectId: string | number = '1') {
  return getScheduleFs(projectId);
}

/** SWA/IAR item-number list. Does not load chart progress. */
export function listScheduleActivities(projectId: string | number) {
  return listScheduleActivitiesFs(projectId);
}

/** Fast path for Bar Chart — selected project only, no full S-curve rebuild. */
export function getBarChart(projectId: string | number = '1') {
  return getBarChartFs(projectId);
}

export function saveSchedule(payload: {
  project_id: string | number;
  activities: PdmActivity[];
  dependencies: PdmDependency[];
  barChartTimeNow?: number;
  barChartTasks?: BarChartTask[];
  barChartTotalDays?: number;
}) {
  return saveScheduleFs(payload);
}

export function clearSchedule(projectId: string | number) {
  return clearScheduleFs(projectId);
}

export function loadReferenceSchedule(projectId: string | number) {
  return loadReferenceScheduleFs(projectId);
}

export function getProjectScheduleVersions(projectId: string | number) {
  return getProjectScheduleVersionsFs(projectId);
}

export function getScheduleVersion(projectId: string | number, versionId: string) {
  return getScheduleVersionFs(projectId, versionId);
}

export function createSuspendedProjectSchedule(projectId: string | number) {
  return createSuspendedProjectScheduleFs(projectId);
}

export type { ProjectScheduleVersions };

export type { ReportProgressEntry };
