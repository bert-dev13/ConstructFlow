import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import type { Role } from '../../types';
import type { WorkItem } from '../workItems';
import { computeWorkItems } from '../workItems';
import type { ContractorChange, SwaStewaReport, SwaStewaStatus } from '../swaStewaApi';
import { COLLECTIONS, reportAuditPath, reportRevisionsPath } from './collections';
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

  const snap = await getDocs(collection(db, COLLECTIONS.reports));
  const existing = new Set(
    snap.docs.map((d) => String((d.data() as Record<string, unknown>).reportNumber ?? '')),
  );
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export async function listReportsFs(params?: Record<string, string>) {
  let qRef = query(collection(db, COLLECTIONS.reports));
  if (params?.project_id) {
    qRef = query(collection(db, COLLECTIONS.reports), where('projectId', '==', asId(params.project_id)));
  }
  const snap = await getDocs(qRef);
  let reports = snap.docs.map((d) => mapReport(d.id, d.data() as Record<string, unknown>));
  if (params?.status) {
    reports = reports.filter((r) => r.status === params.status);
  }
  if (params?.report_type) {
    reports = reports.filter((r) => r.report_type === params.report_type);
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
  created_by?: string | number;
  actor_name?: string;
}) {
  const projectId = asId(payload.project_id);
  let projectName: string | undefined;
  try {
    const proj = await getDoc(doc(db, COLLECTIONS.projects, projectId));
    if (proj.exists()) projectName = String((proj.data() as Record<string, unknown>).name ?? '');
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
  const docData = omitUndefined({
    reportNumber,
    projectId,
    projectName: projectName ?? null,
    reportType: payload.report_type,
    reportData,
    lineItems: standardized.lineItems ?? [],
    status: 'draft' as SwaStewaStatus,
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
  await updateDoc(ref, {
    status: 'pending_contractor',
    contractorBaseline: data.reportData ?? {},
    contractorChanges: [],
    updatedAt: nowIso(),
  });
  await writeAudit(id, 'sent_to_contractor', {}, actorName);
  await queueEmail(id, 'sent_to_contractor');
  return { status: 'pending_contractor' };
}

export async function contractorConfirmFs(reportId: string | number, actorName?: string) {
  const id = asId(reportId);
  const ref = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Report not found');
  if (String((snap.data() as Record<string, unknown>).status) !== 'pending_contractor') {
    throw new Error('Report is not awaiting contractor confirmation');
  }
  await updateDoc(ref, { status: 'contractor_confirmed', updatedAt: nowIso() });
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
  await updateDoc(ref, { status: 'pending_review', updatedAt: nowIso() });
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
  _generate?: { s_curve?: boolean; pdm?: boolean; bar_chart?: boolean },
  actorName?: string,
) {
  const id = asId(reportId);
  const ref = doc(db, COLLECTIONS.reports, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Report not found');
  const data = snap.data() as Record<string, unknown>;
  const status = String(data.status);
  const role = actorRole as Role | undefined;

  if (role === 'engineer_2') {
    if (status !== 'pending_review') throw new Error('Report is not pending Engineer II review');
    await updateDoc(ref, { status: 'with_engineer_3', updatedAt: nowIso() });
    await writeAudit(id, 'approved_forwarded_e3', {}, actorName);
    await queueEmail(id, 'forwarded_e3');
    return { status: 'with_engineer_3', message: 'Forwarded to Engineer III for checking' };
  }

  if (role === 'engineer_3') {
    if (status !== 'with_engineer_3') throw new Error('Report is not with Engineer III');
    await updateDoc(ref, { status: 'with_engineer_4', updatedAt: nowIso() });
    await writeAudit(id, 'approved_forwarded_e4', {}, actorName);
    await queueEmail(id, 'forwarded_e4');
    return { status: 'with_engineer_4', message: 'Forwarded to Engineer IV for final approval' };
  }

  if (role === 'engineer_4') {
    if (status !== 'with_engineer_4' && status !== 'with_engineer_3') {
      throw new Error('Report is not ready for final approval');
    }
    await updateDoc(ref, { status: 'approved', updatedAt: nowIso() });
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
  await updateDoc(doc(db, COLLECTIONS.reports, id), {
    status: 'rejected',
    rejectionReason: reason,
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
