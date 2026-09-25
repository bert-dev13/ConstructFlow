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
  markReportViewedFs,
  previewReportFs,
  regeneratePdfFs,
  rejectReportFs,
  retryApprovalEmailFs,
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

export type OptionalAttachmentKey = 'pdm' | 'bar_chart' | 's_curve' | 'swa' | 'stewa';

export interface ApprovalActorState {
  approved_by?: string | null;
  approved_role?: string | null;
  approved_at?: string | null;
}

export interface ContractorConfirmationState {
  confirmed_by?: string | null;
  confirmed_role?: string | null;
  confirmed_at?: string | null;
  confirms_swa: boolean;
  confirms_iar: boolean;
}

export interface ReportApprovalFlow {
  contractor_confirmation?: ContractorConfirmationState | null;
  engineer_2?: ApprovalActorState | null;
  engineer_3?: ApprovalActorState | null;
  engineer_4?: ApprovalActorState | null;
  current_stage?:
    | 'draft'
    | 'contractor_confirmation'
    | 'engineer_2'
    | 'engineer_3'
    | 'engineer_4'
    | 'released';
  correction_cycle?: number;
  last_correction_reason?: string | null;
  last_correction_by?: string | null;
  last_correction_role?: string | null;
}

export interface ReportReleaseState {
  optional_attachments?: OptionalAttachmentKey[];
  attachments_released_at?: string | null;
  released_by?: string | null;
  released_role?: string | null;
  email_sent_at?: string | null;
  attachment_urls?: Partial<Record<OptionalAttachmentKey, string>>;
}

export interface ContractorChange {
  field: string;
  label: string;
  old: string;
  new: string;
  comment?: string;
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
  approval_flow?: ReportApprovalFlow;
  release_state?: ReportReleaseState;
  edit_user_ids?: string[];
  last_viewed_by?: string | null;
  last_viewed_at?: string | null;
  created_by?: string | null;
  created_at: string;
  generated_at?: string;
  email_status?: 'NOT_SENT' | 'SENDING' | 'SENT' | 'FAILED';
  email_sent_at?: string | null;
  email_error?: string | null;
  email_message_id?: string | null;
  email_claimed_at?: string | null;
  email_recipients?: string[];
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

export function markReportViewed(reportId: string | number) {
  return markReportViewedFs(reportId);
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
  contractor_changes?: ContractorChange[];
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
  generate?: { s_curve?: boolean; pdm?: boolean; bar_chart?: boolean; swa?: boolean; stewa?: boolean },
): Promise<{ status: string; message?: string; pdf_url?: string; public_url?: string }> {
  return approveReportFs(reportId, actorId, actorRole, generate);
}

export function rejectReport(reportId: string | number, reason: string, actorId?: string | number) {
  return rejectReportFs(reportId, reason, actorId);
}

export function retryApprovalEmail(reportId: string | number) {
  return retryApprovalEmailFs(reportId);
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
