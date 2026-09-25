import type { Role } from '../types';

export type SwaStewaReportKind = 'SWA' | 'STEWA' | 'IAR';

export type SwaStewaStatus =
  | 'draft'
  | 'pending_contractor'
  | 'contractor_confirmed'
  | 'pending_review'
  | 'with_engineer_3'
  | 'with_engineer_4'
  | 'approved'
  | 'rejected'
  | 'generated';

/**
 * Whether this role may create or edit drafts for the given report type.
 */
export function canUserEditReportType(
  role: Role | undefined,
  reportType: SwaStewaReportKind,
): boolean {
  if (!role) return false;
  if (role === 'engineer_1') return true;
  if (role === 'engineer_2') return reportType === 'SWA' || reportType === 'STEWA';
  if (role === 'contractor') return true;
  return false;
}

export function canUserCreateReportType(
  role: Role | undefined,
  reportType: SwaStewaReportKind,
): boolean {
  return canUserEditReportType(role, reportType);
}

/** Edit permission depends on status as well as role. */
export function canEditReport(
  role: Role | undefined,
  reportType: SwaStewaReportKind,
  status: SwaStewaStatus | string,
  editUserIds?: string[] | null,
  userId?: string | null,
): boolean {
  if (!role || !canUserEditReportType(role, reportType)) return false;

  const locked = ['pending_review', 'with_engineer_3', 'with_engineer_4', 'approved', 'generated'];
  if (locked.includes(status)) return false;

  // editUserIds narrows who may change a report during contractor review.
  // Engineer I already has project-scoped access via Firestore rules — do not
  // lock them out of drafts because seed/legacy editUserIds lists are incomplete.
  if (
    role !== 'engineer_1' &&
    editUserIds?.length &&
    userId &&
    !editUserIds.includes(userId)
  ) {
    return false;
  }

  if (role === 'contractor') {
    if (reportType === 'IAR') {
      return ['draft', 'pending_contractor', 'rejected', 'contractor_confirmed'].includes(status);
    }
    // SWA drafts are created by the contractor and saved until they submit
    // them to Engineer II. pending_contractor remains the Engineer I handoff.
    if (reportType === 'SWA' || reportType === 'STEWA') {
      return ['draft', 'pending_contractor', 'rejected'].includes(status);
    }
    return status === 'pending_contractor' || status === 'rejected';
  }

  if (role === 'engineer_2') {
    return status === 'draft' || status === 'rejected';
  }

  // Engineer I
  return ['draft', 'rejected', 'pending_contractor', 'contractor_confirmed'].includes(status);
}

/** Engineer I may permanently delete only their own drafts. */
export function canDeleteDraftReport(
  role: Role | undefined,
  status: SwaStewaStatus | string,
  createdBy?: string | null,
  userId?: string | null,
): boolean {
  if (role !== 'engineer_1') return false;
  if (status !== 'draft') return false;
  if (!userId || !createdBy) return false;
  return String(createdBy) === String(userId);
}

export function reportIsViewOnly(
  role: Role | undefined,
  reportType: SwaStewaReportKind,
  status?: SwaStewaStatus | string,
  editUserIds?: string[] | null,
  userId?: string | null,
): boolean {
  if (status) return !canEditReport(role, reportType, status, editUserIds, userId);
  return !canUserEditReportType(role, reportType);
}

export function contractorReportIsViewOnly(
  role: Role | undefined,
  reportType: SwaStewaReportKind,
  status?: SwaStewaStatus | string,
  editUserIds?: string[] | null,
  userId?: string | null,
): boolean {
  if (role !== 'contractor') return false;
  if (status) return !canEditReport(role, reportType, status, editUserIds, userId);
  return reportType !== 'IAR';
}

export function statusLabel(status: SwaStewaStatus | string): string {
  const labels: Record<string, string> = {
    draft: 'Draft',
    pending_contractor: 'Awaiting contractor',
    contractor_confirmed: 'Contractor confirmed',
    pending_review: 'Pending Engineer II',
    with_engineer_3: 'With Engineer III',
    with_engineer_4: 'With Engineer IV',
    approved: 'Approved',
    rejected: 'Revision requested',
    generated: 'Generated',
  };
  return labels[status] ?? status;
}
