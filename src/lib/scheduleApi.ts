import type { BarChartTask, PdmActivity, PdmDependency } from '../types';
import type { ReportProgressEntry } from '../components/ReportProgressFeed';
import {
  clearScheduleFs,
  getScheduleFs,
  loadReferenceScheduleFs,
  saveScheduleFs,
  type ProjectScheduleDoc,
} from './firebase/schedules';

export type ProjectSchedule = ProjectScheduleDoc;

export function getSchedule(projectId: string | number = '1') {
  return getScheduleFs(projectId);
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
