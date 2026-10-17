import type { ProgressReport } from '../types';

export const CURRENT_PERIOD = '2026-W30';

export const KPI_DATA = {
  visibleProjects: { value: 2, label: 'Active construction projects' },
  pendingApprovals: { value: 4, label: 'Awaiting Engineer II / III review' },
  delayedProjects: { value: 1, label: 'Behind planned S-curve progress' },
  inputWarnings: { value: 3, label: `${CURRENT_PERIOD} required fields` },
};

export const CHART_DATA = [
  { week: 'W18', planned: 45, actual: null },
  { week: 'W19', planned: 72, actual: null },
  { week: 'W20', planned: 100, actual: null },
  { week: 'W21', planned: 100, actual: 61 },
  { week: 'W22', planned: 100, actual: 55 },
  { week: 'W30', planned: 100, actual: 40 },
];

export const ALERTS = [
  {
    id: '1',
    title: 'Pending approvals',
    subtitle: '4 reports waiting for Engineer II review.',
    count: 4,
    type: 'summary' as const,
  },
  {
    id: '2',
    title: 'Administration Building Line Extension',
    tag: 'DELAYED',
    type: 'project' as const,
  },
  {
    id: '3',
    title: 'North Zone Pipe Replacement',
    tag: 'ENGINEER II',
    subtitle: '1 report waiting',
    type: 'project' as const,
  },
  {
    id: '4',
    title: 'Provincial Capitol Annex',
    tag: 'ENGINEER III',
    type: 'project' as const,
  },
];

export const SAMPLE_REPORTS: ProgressReport[] = [
  {
    id: 'rpt-001',
    projectName: 'Provincial Capitol Annex',
    type: 'PROGRESS',
    period: '2026-W30',
    status: 'with_engineer_2',
    submittedBy: 'Engr. Juan Dela Cruz',
    submittedAt: '2026-05-28',
    qrCode: 'PEO-RPT-2026W30-001',
  },
  {
    id: 'rpt-002',
    projectName: 'North Zone Pipe Replacement',
    type: 'SWA',
    period: '2026-W29',
    status: 'approved',
    submittedBy: 'Engr. Juan Dela Cruz',
    submittedAt: '2026-05-21',
    qrCode: 'PEO-RPT-2026W29-002',
  },
  {
    id: 'rpt-003',
    projectName: 'Administration Building Extension',
    type: 'STEWA',
    period: '2026-W30',
    status: 'revision_requested',
    submittedBy: 'Engr. Juan Dela Cruz',
    submittedAt: '2026-05-27',
    qrCode: 'PEO-RPT-2026W30-003',
    comments: 'Please update actual percent complete for framing activity.',
  },
];

export const REPORT_STATUS_LABELS: Record<ProgressReport['status'], string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  with_engineer_2: 'Pending',
  revision_requested: 'Revision Requested',
  with_engineer_3: 'Pending',
  approved: 'Approved',
};
