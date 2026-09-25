import type { Role } from '../types';

const CHART_VIEW_ROLES: Role[] = [
  'engineer_1',
  'engineer_2',
  'engineer_3',
  'engineer_4',
  'contractor',
];

/** Roles allowed to open PDM / S-Curve / Bar Chart pages. */
export function chartViewRoles(): Role[] {
  return [...CHART_VIEW_ROLES];
}

export function canViewProjectCharts(role: Role | null | undefined): boolean {
  return role != null && CHART_VIEW_ROLES.includes(role);
}

/**
 * Who may change schedule chart settings, cost items, or persist S-Curve/Bar updates.
 * Matches Firestore `schedules` / `sCurves` write rules (Engineer I + Contractor).
 * Engineer II / III / IV are view-only.
 */
export function canEditProjectCharts(role: Role | null | undefined): boolean {
  return role === 'engineer_1' || role === 'contractor';
}
