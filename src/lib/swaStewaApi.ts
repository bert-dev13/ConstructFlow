import type { WorkItem } from './workItems';
import {
  approveReportFs,
  contractorConfirmFs,
  deleteReportFs,
  emailApproveFromLinkFs,
  emailReviseFromLinkFs,
  getReportFs,
  getIarProgressFs,
  getStewaFromSwaFs,
  listReportAuditFs,
  listReportRevisionsFs,
  listReportsFs,
  previewReportFs,
  regeneratePdfFs,
  rejectReportFs,
  saveReportFs,
  sendToContractorFs,
  submitReportFs,
  verifyReportQrFs,
} from './firebase/reports';


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

export interface ContractorChange {
  field: string;
  label: string;
  old: string;
  new: string;
}

export interface SwaStewaReport {
  id: string;
  report_number: string;
  project_id: string;
  report_type: 'SWA' | 'STEWA' | 'IAR';
  report_data: Record<string, unknown>;
  line_items: WorkItem[];
  pdf_file?: string;
  qr_code?: string;
  public_url?: string;
  status: SwaStewaStatus;
  project_name?: string;
  rejection_reason?: string;
  contractor_changes?: ContractorChange[];
  created_by?: string | null;
  created_at: string;
  generated_at?: string;
}

export function verifyReportQr(qr: string) {
  return verifyReportQrFs(qr);
}

export function listReports(params?: Record<string, string>) {
  return listReportsFs(params);
}

export function getReport(idOrNumber: string) {
  return getReportFs(idOrNumber);
}

export function getStewaFromSwa(projectId: string | number, reportDate: string) {
  return getStewaFromSwaFs(projectId, reportDate);
}

export function getIarProgress(projectId: string | number, reportDate?: string) {
  return getIarProgressFs(projectId, reportDate);
}

export function saveReport(payload: {
  id?: string | number;
  report_type: 'SWA' | 'STEWA' | 'IAR';
  project_id: string | number;
  report_data: Record<string, unknown>;
  line_items?: WorkItem[];
  created_by?: string | number;
}) {
  return saveReportFs(payload);
}

export function previewReport(payload: Parameters<typeof saveReport>[0]) {
  return previewReportFs(payload);
}

export function submitReport(reportId: string | number, actorId?: string | number) {
  return submitReportFs(reportId, actorId);
}

export function sendToContractor(reportId: string | number) {
  return sendToContractorFs(reportId);
}

export function contractorConfirm(reportId: string | number) {
  return contractorConfirmFs(reportId);
}

export function listReportRevisions(reportId: string | number) {
  return listReportRevisionsFs(reportId);
}

export function listReportAudit(reportId: string | number) {
  return listReportAuditFs(reportId);
}

export function approveReport(
  reportId: string | number,
  actorId?: string | number,
  actorRole?: string,
  generate?: { s_curve?: boolean; pdm?: boolean; bar_chart?: boolean },
): Promise<{ status: string; message?: string; pdf_url?: string; public_url?: string }> {
  return approveReportFs(reportId, actorId, actorRole, generate);
}

export function rejectReport(reportId: string | number, reason: string, actorId?: string | number) {
  return rejectReportFs(reportId, reason, actorId);
}

export function emailApproveFromLink(reportId: string | number, token: string) {
  return emailApproveFromLinkFs(reportId, token);
}

export function emailReviseFromLink(reportId: string | number, token: string, reason: string) {
  return emailReviseFromLinkFs(reportId, token, reason);
}

export function regeneratePdf(reportIdOrNumber: string | number) {
  return regeneratePdfFs(reportIdOrNumber);
}

export function deleteReport(reportId: string | number) {
  return deleteReportFs(reportId);
}
