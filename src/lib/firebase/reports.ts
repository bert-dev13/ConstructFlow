import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import type { Role } from '../../types';
import type { WorkItem } from '../workItems';
import { computeWorkItems } from '../workItems';
import type {
  ApprovalActorState,
  ContractorChange,
  ContractorConfirmationState,
  OptionalAttachmentKey,
  ReportApprovalFlow,
  ReportReleaseState,
  SwaStewaReport,
  SwaStewaStatus,
} from '../swaStewaApi';
import { COLLECTIONS, reportAuditPath, reportRevisionsPath } from './collections';
import { getAccessContext, readProjectAccess } from './access';
import { db, functions, storage } from './config';
import { asId, nowIso, omitUndefined } from './ids';
import { syncProgressCharts } from './sCurves';
import { listPayItems as listPayItemsFs, type PayItem } from './payItems';
import { BASE_URL } from '../paths';

function enrichReportData(
  reportType: 'SWA' | 'STEWA' | 'IAR',
  reportData: Record<string, unknown>,
  lineItems?: WorkItem[],
): Record<string, unknown> {
  const data = { ...reportData };
  if (reportType === 'SWA' && lineItems && lineItems.length > 0) {
    const { totals } = computeWorkItems(lineItems);
    data.percent_actual = Math.round(totals.totalToDateWeightPct * 1000) / 1000;
    data.computed_totals = totals;
  }
  if (
    (reportType === 'STEWA' || reportType === 'IAR') &&
    data.percent_actual != null &&
    !Number.isNaN(Number(data.percent_actual))
  ) {
    data.percent_actual = Math.round(Number(data.percent_actual) * 1000) / 1000;
  }
  return data;
}

function publicReportUrl(reportNumber: string) {
  return `${typeof window !== 'undefined' ? window.location.origin : ''}${BASE_URL}reports/view/${encodeURIComponent(reportNumber)}`;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
}

function actorState(value: unknown): ApprovalActorState | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  return {
    approved_by: data.approvedBy != null ? String(data.approvedBy) : null,
    approved_role: data.approvedRole != null ? String(data.approvedRole) : null,
    approved_at: data.approvedAt != null ? String(data.approvedAt) : null,
  };
}

function contractorConfirmationState(value: unknown): ContractorConfirmationState | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  return {
    confirmed_by: data.confirmedBy != null ? String(data.confirmedBy) : null,
    confirmed_role: data.confirmedRole != null ? String(data.confirmedRole) : null,
    confirmed_at: data.confirmedAt != null ? String(data.confirmedAt) : null,
    confirms_swa: data.confirmsSwa === true,
    confirms_iar: data.confirmsIar === true,
  };
}

function approvalFlowState(value: unknown): ReportApprovalFlow | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  return {
    contractor_confirmation: contractorConfirmationState(data.contractorConfirmation),
    engineer_2: actorState(data.engineer2),
    engineer_3: actorState(data.engineer3),
    engineer_4: actorState(data.engineer4),
    current_stage:
      data.currentStage != null ? String(data.currentStage) as ReportApprovalFlow['current_stage'] : undefined,
    correction_cycle:
      data.correctionCycle != null ? Number(data.correctionCycle) : undefined,
    last_correction_reason:
      data.lastCorrectionReason != null ? String(data.lastCorrectionReason) : null,
    last_correction_by:
      data.lastCorrectionBy != null ? String(data.lastCorrectionBy) : null,
    last_correction_role:
      data.lastCorrectionRole != null ? String(data.lastCorrectionRole) : null,
  };
}

function releaseState(value: unknown): ReportReleaseState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  const attachmentUrlsRaw =
    data.attachmentUrls && typeof data.attachmentUrls === 'object'
      ? (data.attachmentUrls as Record<string, unknown>)
      : {};
  const attachmentUrls: Partial<Record<OptionalAttachmentKey, string>> = {};
  for (const key of ['pdm', 'bar_chart', 's_curve', 'swa', 'stewa'] as OptionalAttachmentKey[]) {
    if (attachmentUrlsRaw[key] != null) attachmentUrls[key] = String(attachmentUrlsRaw[key]);
  }
  return {
    optional_attachments: stringArray(data.optionalAttachments) as OptionalAttachmentKey[],
    attachments_released_at:
      data.attachmentsReleasedAt != null ? String(data.attachmentsReleasedAt) : null,
    released_by: data.releasedBy != null ? String(data.releasedBy) : null,
    released_role: data.releasedRole != null ? String(data.releasedRole) : null,
    email_sent_at: data.emailSentAt != null ? String(data.emailSentAt) : null,
    attachment_urls: attachmentUrls,
  };
}

function buildEditableUserIds(
  reportType: 'SWA' | 'STEWA' | 'IAR',
  projectAccessUserIds: string[],
  projectData: Record<string, unknown> | null,
  lastViewedBy?: string | null,
): string[] {
  const access = projectData ? readProjectAccess(projectData) : null;
  const engineer1Ids = access ? access.assignedUserIds.filter((id) => id !== access.contractorId) : [];
  const editable = new Set<string>([...engineer1Ids]);
  if (access?.contractorId) editable.add(access.contractorId);
  if ((reportType === 'SWA' || reportType === 'STEWA') && access?.involvedUserIds.length) {
    for (const id of access.involvedUserIds) editable.add(id);
  }
  if (lastViewedBy) editable.add(lastViewedBy);
  if (!editable.size) {
    for (const id of projectAccessUserIds) editable.add(id);
  }
  return [...editable];
}

function initialApprovalFlow(reportType: 'SWA' | 'STEWA' | 'IAR'): ReportApprovalFlow | undefined {
  if (reportType !== 'IAR') return undefined;
  return {
    contractor_confirmation: null,
    engineer_2: null,
    engineer_3: null,
    engineer_4: null,
    current_stage: 'draft',
    correction_cycle: 0,
    last_correction_reason: null,
    last_correction_by: null,
    last_correction_role: null,
  };
}

function selectedOptionalAttachments(generate?: {
  s_curve?: boolean;
  pdm?: boolean;
  bar_chart?: boolean;
  swa?: boolean;
  stewa?: boolean;
}): OptionalAttachmentKey[] {
  if (!generate) return [];
  return ([
    ['s_curve', generate.s_curve],
    ['pdm', generate.pdm],
    ['bar_chart', generate.bar_chart],
    ['swa', generate.swa],
    ['stewa', generate.stewa],
  ] as const)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

function standardizePayItemRow(row: Record<string, unknown>, masters: Map<string, PayItem>) {
  const payItemId = row.payItemId ? String(row.payItemId) : '';
  const master = payItemId ? masters.get(payItemId) : undefined;
  if (payItemId && !master) {
    throw new Error(`Pay Item ${payItemId} could not be validated.`);
  }
  if (!master) return row;
  return {
    ...row,
    payItemId: master.id,
    payItemVersion: master.version,
    snapshotItemNo: master.itemNo,
    snapshotDescription: master.description,
    snapshotUnit: master.unit,
    itemNo: master.itemNo,
    description: master.description,
    unit: master.unit,
  };
}

async function standardizeReportPayItems(
  reportData: Record<string, unknown>,
  lineItems: WorkItem[] | undefined,
) {
  const masters = new Map((await listPayItemsFs(true)).map((item) => [item.id, item]));
  const normalizedLineItems = lineItems?.map((item) =>
    standardizePayItemRow(item as unknown as Record<string, unknown>, masters) as unknown as WorkItem,
  );
  const normalizedData = { ...reportData };
  for (const key of ['accomplishment_items', 'variation_items']) {
    const rows = normalizedData[key];
    if (Array.isArray(rows)) {
      normalizedData[key] = rows.map((row) =>
        standardizePayItemRow(row as Record<string, unknown>, masters),
      );
    }
  }
  return { reportData: normalizedData, lineItems: normalizedLineItems };
}

function mapReport(id: string, data: Record<string, unknown>): SwaStewaReport {
  return {
    id,
    report_number: String(data.reportNumber ?? ''),
    project_id: asId(data.projectId as string),
    report_type: data.reportType as 'SWA' | 'STEWA' | 'IAR',
    report_data: (data.reportData as Record<string, unknown>) ?? {},
    line_items: (data.lineItems as WorkItem[]) ?? [],
    pdf_file: (data.pdfPath as string | undefined) ?? undefined,
    qr_code: (data.qrCode as string | undefined) ?? undefined,
    public_url: (data.publicUrl as string | undefined) ?? undefined,
    status: data.status as SwaStewaStatus,
    project_name: (data.projectName as string | undefined) ?? undefined,
    rejection_reason: (data.rejectionReason as string | undefined) ?? undefined,
    contractor_changes: (data.contractorChanges as ContractorChange[] | undefined) ?? undefined,
    approval_flow: approvalFlowState(data.approvalFlow),
    release_state: releaseState(data.releaseState),
    edit_user_ids: stringArray(data.editUserIds),
    last_viewed_by: data.lastViewedBy != null ? String(data.lastViewedBy) : null,
    last_viewed_at: data.lastViewedAt != null ? String(data.lastViewedAt) : null,
    created_by: data.createdBy != null ? asId(data.createdBy as string) : null,
    created_at: String(data.createdAt ?? ''),
    generated_at: (data.generatedAt as string | undefined) ?? undefined,
  };
}

async function writeAudit(
  reportId: string,
  action: string,
  details: Record<string, unknown> = {},
  actorName?: string,
) {
  await addDoc(collection(db, reportAuditPath(reportId)), {
    action,
    details,
    actorName: actorName ?? null,
    createdAt: nowIso(),
  });
}

async function nextReportNumber(type: string, reportDate?: string | null): Promise<string> {
  const ts = reportDate ? new Date(`${reportDate}T00:00:00`) : new Date();
  const year = ts.getFullYear();
  const month = ts.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const startDay = ts.getDate();
  const end = new Date(ts);
  end.setDate(end.getDate() + 6);
  const endDay = end.getDate();
  const base = `${type}-${year}-${month}-${startDay}-${endDay}`;
  const counterRef = doc(db, COLLECTIONS.counters, `reportNumber_${base}`);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const nextSuffix = Number((snap.data() as Record<string, unknown> | undefined)?.nextSuffix ?? 1);
    tx.set(
      counterRef,
      {
        kind: 'report_number',
        base,
        nextSuffix: nextSuffix + 1,
        updatedAt: nowIso(),
      },
      { merge: true },
    );
    return nextSuffix <= 1 ? base : `${base}-${nextSuffix}`;
  });
}

export async function listReportsFs(params?: Record<string, string>) {
  const access = await getAccessContext();
  if (!access) return { reports: [] as SwaStewaReport[] };
  const reportType = params?.report_type ?? params?.type;
  let qRef = query(collection(db, COLLECTIONS.reports));
  if (access?.hasGlobalProjectAccess) {
    if (params?.project_id) {
      qRef = query(collection(db, COLLECTIONS.reports), where('projectId', '==', asId(params.project_id)));
    }
  } else if (access?.uid) {
    if (params?.project_id) {
      qRef = query(collection(db, COLLECTIONS.reports), where('projectId', '==', asId(params.project_id)));
    } else {
      qRef = query(
        collection(db, COLLECTIONS.reports),
        where('accessUserIds', 'array-contains', access.uid),
      );
    }
  }
  const snap = await getDocs(qRef);
  let reports = snap.docs.map((d) => mapReport(d.id, d.data() as Record<string, unknown>));
  if (params?.project_id) {
    reports = reports.filter((r) => r.project_id === asId(params.project_id));
  }
  if (params?.status) {
    reports = reports.filter((r) => r.status === params.status);
  }
  if (reportType) {
    reports = reports.filter((r) => r.report_type === reportType);
  }
  reports.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { reports };
}

export async function getReportFs(idOrNumber: string) {
  if (idOrNumber.includes('-') && !/^[A-Za-z0-9]{20,}$/.test(idOrNumber)) {
    const q = query(
      collection(db, COLLECTIONS.reports),
      where('reportNumber', '==', idOrNumber),
    );
    const snap = await getDocs(q);
    if (snap.empty) throw new Error('Report not found');
    const d = snap.docs[0];
    const report = mapReport(d.id, d.data() as Record<string, unknown>);
    const verified = ['approved', 'generated'].includes(report.status);
    return {
      report,
      valid: true,
      verified,
      pdf_url: report.pdf_file,
    };
  }
  const snap = await getDoc(doc(db, COLLECTIONS.reports, idOrNumber));
  if (!snap.exists()) throw new Error('Report not found');
  const report = mapReport(snap.id, snap.data() as Record<string, unknown>);
  return {
    report,
    valid: true,
    verified: ['approved', 'generated'].includes(report.status),
    pdf_url: report.pdf_file,
  };
}

export async function markReportViewedFs(reportId: string | number) {
  const access = await getAccessContext();
  if (!access?.uid) return { ok: false };
  await updateDoc(doc(db, COLLECTIONS.reports, asId(reportId)), {
    lastViewedBy: access.uid,
    lastViewedAt: nowIso(),
    updatedAt: nowIso(),
  });
  return { ok: true };
}

export async function verifyReportQrFs(qr: string) {
  const q = query(collection(db, COLLECTIONS.reports), where('qrCode', '==', qr));
  const snap = await getDocs(q);
  if (snap.empty) {
    // also allow verify by report number
    try {
      const byNumber = await getReportFs(qr);
      const verified = ['approved', 'generated'].includes(byNumber.report.status);
      return {
        valid: verified,
        verified,
        report: byNumber.report,
        message: verified ? 'Report verified' : 'Report found but not yet approved',
      };
    } catch {
      return { valid: false, message: 'Invalid QR code' };
    }
  }
  const report = mapReport(snap.docs[0].id, snap.docs[0].data() as Record<string, unknown>);
  const verified = ['approved', 'generated'].includes(report.status);
  return {
    valid: verified,
    verified,
    report,
    message: verified ? 'Report verified' : 'Report found but not yet approved',
  };
}

export async function getStewaFromSwaFs(projectId: string | number, reportDate: string) {
  const { reports } = await listReportsFs({
    project_id: asId(projectId),
    report_type: 'SWA',
  });
  const approved = reports.filter((r) => ['approved', 'generated'].includes(r.status));
  const match =
    approved.find((r) => String(r.report_data.report_date ?? '') === reportDate) ||
    approved[0];
  if (!match) {
    return {
      percent_actual: null,
      percent_planned: null,
      swa_report_number: null,
      slippage: null,
    };
  }
  const actual = Number(match.report_data.percent_actual ?? match.report_data.percent_complete ?? 0);
  const planned = Number(match.report_data.percent_planned ?? match.report_data.percent_target ?? null);
  return {
    percent_actual: Number.isFinite(actual) ? actual : null,
    percent_planned: Number.isFinite(planned) ? planned : null,
    swa_report_number: match.report_number,
    slippage:
      Number.isFinite(actual) && Number.isFinite(planned)
        ? Math.round((actual - planned) * 100) / 100
        : null,
  };
}

export async function getIarProgressFs(projectId: string | number, reportDate?: string) {
  const { reports } = await listReportsFs({ project_id: asId(projectId) });
  const usable = reports.filter((report) =>
    ['approved', 'generated', 'pending_review', 'with_engineer_3', 'with_engineer_4'].includes(report.status),
  );
  const matching = (type: 'SWA' | 'STEWA') =>
    usable
      .filter((report) => report.report_type === type)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .find((report) => !reportDate || String(report.report_data.report_date ?? '') === reportDate)
      ?? usable
        .filter((report) => report.report_type === type)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  const swa = matching('SWA');
  const stewa = matching('STEWA');
  const swaData = swa?.report_data ?? {};
  const stewaData = stewa?.report_data ?? {};
  const actual = Number(
    swaData.percent_actual
      ?? swaData.actual_progress
      ?? (swaData.computed_totals as Record<string, unknown> | undefined)?.totalToDateWeightPct,
  );
  const originalTarget = Number(
    stewaData.orig_target
      ?? stewaData.original_target
      ?? stewaData.percent_planned,
  );
  const revisedTarget = Number(
    stewaData.rev_target
      ?? stewaData.revised_target
      ?? stewaData.percent_planned
      ?? originalTarget,
  );
  const planned = Number.isFinite(revisedTarget) ? revisedTarget : originalTarget;
  return {
    orig_target: Number.isFinite(originalTarget) ? originalTarget : null,
    rev_target: Number.isFinite(revisedTarget) ? revisedTarget : null,
    actual_progress: Number.isFinite(actual) ? actual : null,
    variance: Number.isFinite(actual) && Number.isFinite(planned) ? actual - planned : null,
    source_swa: swa?.report_number ?? null,
    source_stewa: stewa?.report_number ?? null,
  };
}

export async function saveReportFs(payload: {
  id?: string | number;
  report_type: 'SWA' | 'STEWA' | 'IAR';
  project_id: string | number;
  report_data: Record<string, unknown>;
  line_items?: WorkItem[];
  contractor_changes?: ContractorChange[];
  created_by?: string | number;
  actor_name?: string;
}) {
  const projectId = asId(payload.project_id);
  let projectName: string | undefined;
  let accessUserIds: string[] = [];
  let projectData: Record<string, unknown> | null = null;
  try {
    const proj = await getDoc(doc(db, COLLECTIONS.projects, projectId));
    if (proj.exists()) {
      projectData = proj.data() as Record<string, unknown>;
      projectName = String(projectData.name ?? '');
      accessUserIds = readProjectAccess(projectData).accessUserIds;
    }
  } catch {
    /* ignore */
  }

  const standardized = await standardizeReportPayItems(
    payload.report_data,
    payload.line_items,
  );
  const reportData = enrichReportData(
    payload.report_type,
    standardized.reportData,
    standardized.lineItems,
  );

  if (payload.id) {
    const id = asId(payload.id);
    const ref = doc(db, COLLECTIONS.reports, id);
    const existing = await getDoc(ref);
    if (!existing.exists()) throw new Error('Report not found');
    const prev = existing.data() as Record<string, unknown>;
    const existingEditUserIds = stringArray(prev.editUserIds);
    const nextEditUserIds =
      existingEditUserIds.length > 0
        ? existingEditUserIds
        : buildEditableUserIds(
            payload.report_type,
            accessUserIds,
            projectData,
            prev.lastViewedBy != null ? String(prev.lastViewedBy) : null,
          );
    await addDoc(collection(db, reportRevisionsPath(id)), {
      revisionNumber: Date.now(),
      reportData: prev.reportData ?? {},
      lineItems: prev.lineItems ?? [],
      createdAt: nowIso(),
      changedByName: payload.actor_name ?? null,
    });
    await updateDoc(ref, omitUndefined({
      reportData,
      lineItems: standardized.lineItems ?? (prev.lineItems as WorkItem[] | undefined) ?? [],
      projectName: projectName ?? prev.projectName,
      accessUserIds:
        accessUserIds.length > 0
          ? accessUserIds
          : ((prev.accessUserIds as string[] | undefined) ?? []),
      editUserIds: nextEditUserIds,
      contractorChanges: payload.contractor_changes ?? (prev.contractorChanges as ContractorChange[] | undefined) ?? [],
      approvalFlow: (prev.approvalFlow as Record<string, unknown> | undefined)
        ?? initialApprovalFlow(payload.report_type),
      releaseState: (prev.releaseState as Record<string, unknown> | undefined) ?? null,
      updatedAt: nowIso(),
    }));
    await writeAudit(id, 'saved', {}, payload.actor_name);
    const status = String(prev.status ?? '');
    if (['approved', 'generated'].includes(status) && ['SWA', 'STEWA'].includes(payload.report_type)) {
      try {
        await syncProgressCharts(projectId);
      } catch {
        /* charts optional */
      }
    }
    const snap = await getDoc(ref);
    return { report: mapReport(snap.id, snap.data() as Record<string, unknown>) };
  }

  const reportNumber = await nextReportNumber(
    payload.report_type,
    String(reportData.report_date ?? '') || null,
  );
  const ref = doc(collection(db, COLLECTIONS.reports));
  const editUserIds = buildEditableUserIds(payload.report_type, accessUserIds, projectData, null);
  const docData = omitUndefined({
    reportNumber,
    projectId,
    projectName: projectName ?? null,
    accessUserIds,
    editUserIds,
    reportType: payload.report_type,
    reportData,
    lineItems: standardized.lineItems ?? [],
    contractorChanges: payload.contractor_changes ?? [],
    status: 'draft' as SwaStewaStatus,
    approvalFlow: initialApprovalFlow(payload.report_type) ?? null,
    releaseState: null,
    publicUrl: publicReportUrl(reportNumber),
    createdBy: payload.created_by != null ? asId(payload.created_by) : null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await setDoc(ref, docData);
  await writeAudit(ref.id, 'created', { reportNumber }, payload.actor_name);
  return { report: mapReport(ref.id, docData as Record<string, unknown>) };
}

export async function previewReportFs(payload: Parameters<typeof saveReportFs>[0]) {
  const saved = await saveReportFs(payload);
  const r = saved.report;
  const preview_html = `<div style="font-family:sans-serif;padding:24px">
    <h1>${r.report_type} Preview</h1>
    <p><strong>Report:</strong> ${r.report_number}</p>
    <p><strong>Project:</strong> ${r.project_name ?? r.project_id}</p>
    <p><strong>Status:</strong> ${r.status}</p>
    <pre style="background:#f5f5f5;padding:12px;overflow:auto">${JSON.stringify(r.report_data, null, 2)}</pre>
  </div>`;
  return { report: r, preview_html };
}

export async function sendToContractorFs(reportId: string | number, actorName?: string) {
  const id = asId(reportId);
  const ref = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  if (!['draft', 'rejected'].includes(String(data.status))) {
    throw new Error('Report cannot be sent to contractor in current status');
  }
  let projectData: Record<string, unknown> | null = null;
  let accessUserIds = stringArray(data.accessUserIds);
  try {
    const projectSnap = await getDoc(doc(db, COLLECTIONS.projects, asId(data.projectId as string)));
    if (projectSnap.exists()) {
      projectData = projectSnap.data() as Record<string, unknown>;
      accessUserIds = readProjectAccess(projectData).accessUserIds;
    }
  } catch {
    /* ignore */
  }
  const nextEditUserIds = buildEditableUserIds(
    data.reportType as 'SWA' | 'STEWA' | 'IAR',
    accessUserIds,
    projectData,
    data.lastViewedBy != null ? String(data.lastViewedBy) : null,
  );
  await updateDoc(ref, {
    status: 'pending_contractor',
    contractorBaseline: data.reportData ?? {},
    contractorChanges: [],
    rejectionReason: null,
    editUserIds: nextEditUserIds,
    approvalFlow:
      data.reportType === 'IAR'
        ? {
            contractorConfirmation: null,
            engineer2: null,
            engineer3: null,
            engineer4: null,
            currentStage: 'contractor_confirmation',
            correctionCycle: Number(
              (data.approvalFlow as Record<string, unknown> | undefined)?.correctionCycle ?? 0,
            ),
            lastCorrectionReason:
              (data.approvalFlow as Record<string, unknown> | undefined)?.lastCorrectionReason ?? null,
            lastCorrectionBy:
              (data.approvalFlow as Record<string, unknown> | undefined)?.lastCorrectionBy ?? null,
            lastCorrectionRole:
              (data.approvalFlow as Record<string, unknown> | undefined)?.lastCorrectionRole ?? null,
          }
        : (data.approvalFlow ?? null),
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'sent_to_contractor', {}, actorName);
  await queueEmail(id, 'sent_to_contractor');
  return { status: 'pending_contractor' };
}

export async function contractorConfirmFs(reportId: string | number, actorName?: string) {
  const access = await getAccessContext();
  const id = asId(reportId);
  const ref = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  if (String(data.status) !== 'pending_contractor') {
    throw new Error('Report is not awaiting contractor confirmation');
  }
  await updateDoc(ref, {
    status: 'contractor_confirmed',
    approvalFlow:
      data.reportType === 'IAR'
        ? {
            contractorConfirmation: {
              confirmedBy: access?.uid ?? null,
              confirmedRole: access?.role ?? 'contractor',
              confirmedAt: nowIso(),
              confirmsSwa: true,
              confirmsIar: true,
            },
            engineer2: null,
            engineer3: null,
            engineer4: null,
            currentStage: 'engineer_2',
            correctionCycle: Number(
              (data.approvalFlow as Record<string, unknown> | undefined)?.correctionCycle ?? 0,
            ),
            lastCorrectionReason:
              (data.approvalFlow as Record<string, unknown> | undefined)?.lastCorrectionReason ?? null,
            lastCorrectionBy:
              (data.approvalFlow as Record<string, unknown> | undefined)?.lastCorrectionBy ?? null,
            lastCorrectionRole:
              (data.approvalFlow as Record<string, unknown> | undefined)?.lastCorrectionRole ?? null,
          }
        : data.approvalFlow ?? null,
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'contractor_confirmed', {}, actorName);
  const updated = await getDoc(ref);
  return {
    status: 'contractor_confirmed',
    report: mapReport(updated.id, updated.data() as Record<string, unknown>),
  };
}

export async function submitReportFs(
  reportId: string | number,
  _actorId?: string | number,
  actorName?: string,
) {
  const id = asId(reportId);
  const ref = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  if (String(data.reportType) === 'IAR') {
    if (String(data.status) !== 'contractor_confirmed') {
      throw new Error('IAR must be contractor-confirmed before Engineer II review');
    }
    const contractorConfirmation =
      ((data.approvalFlow as Record<string, unknown> | undefined)?.contractorConfirmation as
        | Record<string, unknown>
        | undefined) ?? {};
    if (contractorConfirmation.confirmsSwa !== true || contractorConfirmation.confirmsIar !== true) {
      throw new Error('Contractor confirmation is incomplete');
    }
  }
  await updateDoc(ref, {
    status: 'pending_review',
    approvalFlow:
      String(data.reportType) === 'IAR'
        ? {
            ...((data.approvalFlow as Record<string, unknown> | undefined) ?? {}),
            currentStage: 'engineer_2',
          }
        : (data.approvalFlow ?? null),
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'submitted', {}, actorName);
  await queueEmail(id, 'submitted_for_review');
  return { status: 'pending_review' };
}

async function finalizeGenerated(reportId: string, actorName?: string) {
  const reportRef = doc(db, COLLECTIONS.reports, reportId);
  const snap = await getDoc(reportRef);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  const reportNumber = String(data.reportNumber);
  const qrCode = reportNumber;

  let pdfUrl: string | undefined;
  try {
    const finalize = httpsCallable(functions, 'finalizeReport');
    const result = await finalize({ reportId });
    const payload = result.data as { pdf_url?: string; qr_code?: string };
    pdfUrl = payload.pdf_url;
    if (payload.qr_code) {
      await updateDoc(reportRef, { qrCode: payload.qr_code });
    }
  } catch {
    // Client-side fallback: upload a simple HTML "certificate" as the report artifact
    const html = `<!DOCTYPE html><html><body style="font-family:Georgia,serif;padding:40px">
      <h1>ConstructFlow — ${String(data.reportType)} Report</h1>
      <p><strong>Report Number:</strong> ${reportNumber}</p>
      <p><strong>Project:</strong> ${String(data.projectName ?? data.projectId)}</p>
      <p><strong>Status:</strong> Approved / Generated</p>
      <p><strong>QR / Verify code:</strong> ${qrCode}</p>
      <p>Generated at ${nowIso()}</p>
    </body></html>`;
    const fileRef = storageRef(storage, `reports/${reportId}/${reportNumber}.html`);
    await uploadBytes(fileRef, new Blob([html], { type: 'text/html' }), {
      contentType: 'text/html',
    });
    pdfUrl = await getDownloadURL(fileRef);
  }

  await updateDoc(reportRef, {
    status: 'generated',
    pdfPath: pdfUrl ?? null,
    qrCode,
    publicUrl: publicReportUrl(reportNumber),
    approvalFlow:
      String(data.reportType) === 'IAR'
        ? {
            ...((data.approvalFlow as Record<string, unknown> | undefined) ?? {}),
            currentStage: 'released',
          }
        : (data.approvalFlow ?? null),
    releaseState:
      String(data.reportType) === 'IAR'
        ? {
            ...((data.releaseState as Record<string, unknown> | undefined) ?? {}),
            attachmentsReleasedAt: nowIso(),
          }
        : (data.releaseState ?? null),
    generatedAt: nowIso(),
    updatedAt: nowIso(),
  });
  await writeAudit(reportId, 'generated', { pdfUrl }, actorName);
  await queueEmail(reportId, 'final_approved');

  try {
    await syncProgressCharts(asId(data.projectId as string));
  } catch {
    /* schedule/s-curve optional */
  }

  return {
    status: 'generated',
    pdf_url: pdfUrl,
    public_url: publicReportUrl(reportNumber),
  };
}

export async function approveReportFs(
  reportId: string | number,
  _actorId?: string | number,
  actorRole?: string,
  _generate?: { s_curve?: boolean; pdm?: boolean; bar_chart?: boolean; swa?: boolean; stewa?: boolean },
  actorName?: string,
) {
  const access = await getAccessContext();
  const id = asId(reportId);
  const ref = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  const status = String(data.status);
  const role = (actorRole ?? access?.role) as Role | undefined;
  const actorId = _actorId != null ? asId(_actorId) : access?.uid ?? null;
  const selectedAttachments = selectedOptionalAttachments(_generate);
  const isIar = String(data.reportType) === 'IAR';
  const approvalFlowData =
    ((data.approvalFlow as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const contractorConfirmation =
    ((approvalFlowData.contractorConfirmation as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >;

  if (isIar && (contractorConfirmation.confirmsSwa !== true || contractorConfirmation.confirmsIar !== true)) {
    throw new Error('Contractor confirmation is required before engineer approval');
  }

  if (role === 'engineer_2') {
    if (status !== 'pending_review') throw new Error('Report is not pending Engineer II review');
    await updateDoc(ref, {
      status: 'with_engineer_3',
      approvalFlow: isIar
        ? {
            ...approvalFlowData,
            engineer2: { approvedBy: actorId, approvedRole: role, approvedAt: nowIso() },
            currentStage: 'engineer_3',
          }
        : data.approvalFlow ?? null,
      updatedAt: nowIso(),
    });
    await writeAudit(id, 'approved_forwarded_e3', {}, actorName);
    await queueEmail(id, 'forwarded_e3');
    return { status: 'with_engineer_3', message: 'Forwarded to Engineer III for checking' };
  }

  if (role === 'engineer_3') {
    if (status !== 'with_engineer_3') throw new Error('Report is not with Engineer III');
    if (isIar && !approvalFlowData.engineer2) {
      throw new Error('Engineer II approval is required first');
    }
    await updateDoc(ref, {
      status: 'with_engineer_4',
      approvalFlow: isIar
        ? {
            ...approvalFlowData,
            engineer3: { approvedBy: actorId, approvedRole: role, approvedAt: nowIso() },
            currentStage: 'engineer_4',
          }
        : data.approvalFlow ?? null,
      updatedAt: nowIso(),
    });
    await writeAudit(id, 'approved_forwarded_e4', {}, actorName);
    await queueEmail(id, 'forwarded_e4');
    return { status: 'with_engineer_4', message: 'Forwarded to Engineer IV for final approval' };
  }

  if (role === 'engineer_4') {
    if (status !== 'with_engineer_4') {
      throw new Error('Report is not ready for final approval');
    }
    if (isIar && (!approvalFlowData.engineer2 || !approvalFlowData.engineer3)) {
      throw new Error('Engineer II and Engineer III approvals are required first');
    }
    await updateDoc(ref, {
      status: 'approved',
      approvalFlow: isIar
        ? {
            ...approvalFlowData,
            engineer4: { approvedBy: actorId, approvedRole: role, approvedAt: nowIso() },
            currentStage: 'engineer_4',
          }
        : data.approvalFlow ?? null,
      releaseState: isIar
        ? {
            ...((data.releaseState as Record<string, unknown> | undefined) ?? {}),
            optionalAttachments: selectedAttachments,
            releasedBy: actorId,
            releasedRole: role,
            attachmentsReleasedAt: null,
            emailSentAt: null,
          }
        : data.releaseState ?? null,
      updatedAt: nowIso(),
    });
    await writeAudit(id, 'approved', {}, actorName);
    return finalizeGenerated(id, actorName);
  }

  throw new Error('This role cannot approve reports');
}

export async function rejectReportFs(
  reportId: string | number,
  reason: string,
  _actorId?: string | number,
  actorName?: string,
) {
  const id = asId(reportId);
  const access = await getAccessContext();
  const reportRef = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(reportRef);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  let projectData: Record<string, unknown> | null = null;
  let accessUserIds = stringArray(data.accessUserIds);
  try {
    const projectSnap = await getDoc(doc(db, COLLECTIONS.projects, asId(data.projectId as string)));
    if (projectSnap.exists()) {
      projectData = projectSnap.data() as Record<string, unknown>;
      accessUserIds = readProjectAccess(projectData).accessUserIds;
    }
  } catch {
    /* ignore */
  }
  const reopenedEditors = buildEditableUserIds(
    data.reportType as 'SWA' | 'STEWA' | 'IAR',
    accessUserIds,
    projectData,
    data.lastViewedBy != null ? String(data.lastViewedBy) : null,
  );
  const prevApprovalFlow =
    ((data.approvalFlow as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  await updateDoc(reportRef, {
    status: 'rejected',
    rejectionReason: reason,
    editUserIds: reopenedEditors,
    approvalFlow:
      String(data.reportType) === 'IAR'
        ? {
            contractorConfirmation: null,
            engineer2: null,
            engineer3: null,
            engineer4: null,
            currentStage: 'draft',
            correctionCycle: Number(prevApprovalFlow.correctionCycle ?? 0) + 1,
            lastCorrectionReason: reason,
            lastCorrectionBy: _actorId != null ? asId(_actorId) : access?.uid ?? null,
            lastCorrectionRole: access?.role ?? null,
          }
        : data.approvalFlow ?? null,
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'rejected', { reason }, actorName);
  await queueEmail(id, 'revision_requested', { reason });
  return { status: 'rejected' };
}

export async function listReportRevisionsFs(reportId: string | number) {
  const snap = await getDocs(collection(db, reportRevisionsPath(asId(reportId))));
  const revisions = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      revision_number: Number(data.revisionNumber ?? 0),
      report_data: (data.reportData as Record<string, unknown>) ?? {},
      line_items: (data.lineItems as WorkItem[]) ?? [],
      created_at: String(data.createdAt ?? ''),
      changed_by_name: (data.changedByName as string | undefined) ?? undefined,
    };
  });
  revisions.sort((a, b) => b.revision_number - a.revision_number);
  return { revisions };
}

export async function listReportAuditFs(reportId: string | number) {
  const snap = await getDocs(collection(db, reportAuditPath(asId(reportId))));
  const audit = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      action: String(data.action ?? ''),
      details: data.details,
      created_at: String(data.createdAt ?? ''),
      actor_name: (data.actorName as string | undefined) ?? undefined,
    };
  });
  audit.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { audit };
}

export async function regeneratePdfFs(reportIdOrNumber: string | number, actorName?: string) {
  const loaded = await getReportFs(String(reportIdOrNumber));
  const result = await finalizeGenerated(asId(loaded.report.id), actorName);
  return { pdf_url: result.pdf_url ?? '' };
}

export async function deleteReportFs(reportId: string | number) {
  await deleteDoc(doc(db, COLLECTIONS.reports, asId(reportId)));
  return { ok: true };
}

export async function emailApproveFromLinkFs(reportId: string | number, token: string) {
  const id = asId(reportId);
  const snap = await getDoc(doc(db, COLLECTIONS.reports, id));
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  if (String(data.emailApproveToken ?? '') !== token) {
    throw new Error('Invalid or expired token');
  }
  if (String(data.status) !== 'pending_review') {
    throw new Error('Report is not pending review');
  }
  await updateDoc(doc(db, COLLECTIONS.reports, id), {
    status: 'with_engineer_3',
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'email_approved_forwarded');
  return { status: 'with_engineer_3', message: 'Approved via email — forwarded to Engineer III' };
}

export async function emailReviseFromLinkFs(
  reportId: string | number,
  token: string,
  reason: string,
) {
  const id = asId(reportId);
  const snap = await getDoc(doc(db, COLLECTIONS.reports, id));
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  if (String(data.emailReviseToken ?? '') !== token) {
    throw new Error('Invalid or expired token');
  }
  await updateDoc(doc(db, COLLECTIONS.reports, id), {
    status: 'rejected',
    rejectionReason: reason,
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'email_revise', { reason });
  return { status: 'rejected', message: 'Revision request sent to Engineer I' };
}

async function queueEmail(
  reportId: string,
  event: string,
  extra: Record<string, unknown> = {},
) {
  await addDoc(collection(db, COLLECTIONS.emailQueue), {
    reportId,
    event,
    status: 'queued',
    ...extra,
    createdAt: nowIso(),
  });
  try {
    const send = httpsCallable(functions, 'sendWorkflowEmail');
    await send({ reportId, event, ...extra });
  } catch {
    /* Functions optional until deployed */
  }
}
