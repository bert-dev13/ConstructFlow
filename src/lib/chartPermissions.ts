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
 * Matches Firestore `schedules` write rules and full `sCurves` writes (Engineer I + Contractor).
 * Engineer II / III / IV are view-only for those chart settings.
 */
export function canEditProjectCharts(role: Role | null | undefined): boolean {
  return role === 'engineer_1' || role === 'contractor';
}

const SCURVE_PERIOD_EDIT_ROLES: Role[] = [
  'contractor',
  'engineer_1',
  'engineer_2',
  'engineer_3',
  'engineer_4',
];

/**
 * Who may view and save S-Curve period count and per-period target values
 * while a report moves from the contractor through Engineer IV.
 * Does not include changing the original Target Plan baseline.
 */
export function canEditSCurvePeriods(role: Role | null | undefined): boolean {
  return role != null && SCURVE_PERIOD_EDIT_ROLES.includes(role);
}
