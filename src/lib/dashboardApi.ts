import { getDashboardStatsFs, type DashboardData as FsDashboardData } from './firebase/dashboard';

export type DashboardKpi = FsDashboardData['kpis']['visibleProjects'];
export type DashboardData = FsDashboardData;

export function getDashboardStats() {
  return getDashboardStatsFs();
}
