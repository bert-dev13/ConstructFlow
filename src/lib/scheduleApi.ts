import type { BarChartTask, PdmActivity, PdmDependency } from '../types';
import type { ReportProgressEntry } from '../components/ReportProgressFeed';
import {
  clearScheduleFs,
  getBarChartFs,
  getScheduleFs,
  loadReferenceScheduleFs,
  saveScheduleFs,
  type ProjectScheduleDoc,
} from './firebase/schedules';

export type ProjectSchedule = ProjectScheduleDoc;

export function getSchedule(projectId: string | number = '1') {
  return getScheduleFs(projectId);
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

export type { ReportProgressEntry };
