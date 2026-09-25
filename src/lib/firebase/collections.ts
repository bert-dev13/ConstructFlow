export const COLLECTIONS = {
  users: 'users',
  payItems: 'payItems',
  projects: 'projects',
  schedules: 'schedules',
  sCurves: 'sCurves',
  reports: 'reports',
  reportTemplates: 'reportTemplates',
  emailQueue: 'emailQueue',
  emailNotifications: 'emailNotifications',
  counters: 'counters',
} as const;

export function projectAuditPath(projectId: string) {
  return `${COLLECTIONS.projects}/${projectId}/auditLog`;
}

export function projectContractHistoryPath(projectId: string) {
  return `${COLLECTIONS.projects}/${projectId}/contractHistory`;
}

export function reportAuditPath(reportId: string) {
  return `${COLLECTIONS.reports}/${reportId}/audit`;
}

export function reportRevisionsPath(reportId: string) {
  return `${COLLECTIONS.reports}/${reportId}/revisions`;
}

export function sCurveSnapshotsPath(projectId: string) {
  return `${COLLECTIONS.sCurves}/${projectId}/snapshots`;
}

export function scheduleVersionsPath(projectId: string) {
  return `${COLLECTIONS.schedules}/${projectId}/versions`;
}
