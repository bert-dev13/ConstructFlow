import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as nodemailer from 'nodemailer';
import { buildSimplePdf } from './pdf';

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

type OptionalAttachmentKey = 'pdm' | 'bar_chart' | 's_curve' | 'swa' | 'stewa';

const ACCOUNTS: Array<{
  email: string;
  password: string;
  fullName: string;
  role: string;
}> = [
  { email: 'constructflow.contractor.1@gmail.com', password: 'fortesting01', fullName: 'Contractor', role: 'contractor' },
  { email: 'constructflow.engineerr1@gmail.com', password: 'fortesting01', fullName: 'Engineer I', role: 'engineer_1' },
  { email: 'constructflow.engineerii@gmail.com', password: 'EngineerII', fullName: 'Engineer II', role: 'engineer_2' },
  { email: 'constructflow.engineerIII@gmail.com', password: 'Engineer 3', fullName: 'Engineer III', role: 'engineer_3' },
  { email: 'constructflow.engineer4@gmail.com', password: 'Engineer 4', fullName: 'Engineer IV', role: 'engineer_4' },
];

const PROJECT_SPECS = [
  {
    id: 'demo-capitol-annex',
    name: 'Provincial Capitol Annex',
    location: 'Tuguegarao City, Cagayan',
    status: 'active',
    startDate: '2025-07-01',
    plannedEndDate: '2025-10-19',
    contractAmount: 5991119.01,
    contractorEmail: 'constructflow.contractor.1@gmail.com',
    engineer1Email: 'constructflow.engineerr1@gmail.com',
    engineer2Emails: ['constructflow.engineerii@gmail.com'],
  },
  {
    id: 'demo-remebella-road',
    name: 'Remebella Road Improvement',
    location: 'Remebella, Buguey, Cagayan',
    status: 'active',
    startDate: '2025-07-01',
    plannedEndDate: '2025-10-19',
    contractAmount: 5991119.01,
    contractorEmail: 'constructflow.contractor.1@gmail.com',
    engineer1Email: 'constructflow.engineerr1@gmail.com',
    engineer2Emails: ['constructflow.engineerii@gmail.com'],
  },
  {
    id: 'demo-north-zone-pipe',
    name: 'North Zone Pipe Replacement',
    location: 'North Zone, Cagayan',
    status: 'active',
    startDate: '2025-08-01',
    plannedEndDate: '2025-12-15',
    contractAmount: 2500000,
    contractorEmail: 'constructflow.contractor.1@gmail.com',
    engineer1Email: 'constructflow.engineerr1@gmail.com',
    engineer2Emails: ['constructflow.engineerii@gmail.com'],
  },
] as const;

function nowIso() {
  return new Date().toISOString();
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
    : [];
}

function buildProjectAccess(input: {
  contractorId?: string | null;
  assignedUserIds?: string[];
  involvedUserIds?: string[];
}) {
  const assignedUserIds = uniqueIds([...(input.assignedUserIds ?? []), input.contractorId ?? null]);
  const involvedUserIds = uniqueIds(input.involvedUserIds ?? []);
  return {
    contractorId: input.contractorId ?? null,
    assignedUserIds,
    involvedUserIds,
    accessUserIds: uniqueIds([input.contractorId ?? null, ...assignedUserIds, ...involvedUserIds]),
  };
}

function parseReportNumberCounter(reportNumber: string) {
  const parts = reportNumber.split('-');
  if (parts.length > 5) {
    const suffix = Number(parts[parts.length - 1]);
    if (Number.isFinite(suffix)) {
      return {
        base: parts.slice(0, -1).join('-'),
        nextSuffix: suffix + 1,
      };
    }
  }
  return { base: reportNumber, nextSuffix: 2 };
}

async function writeReportAudit(reportId: string, action: string, details: Record<string, unknown> = {}) {
  await db.collection(`reports/${reportId}/audit`).add({
    action,
    details,
    createdAt: nowIso(),
    actorName: 'cloud-function',
  });
}

async function writeProjectAudit(projectId: string, fieldName: string, oldValue: unknown, newValue: unknown) {
  await db.collection(`projects/${projectId}/auditLog`).add({
    fieldName,
    oldValue: oldValue != null ? String(oldValue) : null,
    newValue: newValue != null ? String(newValue) : null,
    createdAt: nowIso(),
    actorName: 'cloud-function',
  });
}

async function resolveUserEmailsByIds(userIds: string[]) {
  const emails: string[] = [];
  for (const userId of uniqueIds(userIds)) {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) continue;
    const email = String(snap.data()?.email ?? '').trim();
    if (email) emails.push(email);
  }
  return uniqueIds(emails);
}

async function resolveRoleEmails(role: string) {
  const snap = await db.collection('users').where('role', '==', role).get();
  return uniqueIds(
    snap.docs.map((doc) => String(doc.data().email ?? '').trim()).filter((email) => email.length > 0),
  );
}

async function resolveProjectRecipients(projectId: string, projectData?: FirebaseFirestore.DocumentData) {
  const projectSnap = projectData ? null : await db.collection('projects').doc(projectId).get();
  const project = projectData ?? projectSnap?.data();
  if (!project) return [];
  const assignedUserIds = stringArray(project.assignedUserIds);
  const involvedUserIds = stringArray(project.involvedUserIds);
  const contractorId = typeof project.contractorId === 'string' ? project.contractorId : null;
  const recipientIds = uniqueIds([contractorId, ...assignedUserIds, ...involvedUserIds]);
  const [directEmails, engineer3Emails, engineer4Emails] = await Promise.all([
    resolveUserEmailsByIds(recipientIds),
    resolveRoleEmails('engineer_3'),
    resolveRoleEmails('engineer_4'),
  ]);
  return uniqueIds([...directEmails, ...engineer3Emails, ...engineer4Emails]);
}

async function uploadPdfAttachment(path: string, pdf: Buffer) {
  const file = bucket.file(path);
  await file.save(pdf, { contentType: 'application/pdf', public: true });
  return `https://storage.googleapis.com/${bucket.name}/${path}`;
}

async function resolveLatestApprovedReportFile(projectId: string, reportType: 'SWA' | 'STEWA') {
  const snap = await db
    .collection('reports')
    .where('projectId', '==', projectId)
    .where('reportType', '==', reportType)
    .get();
  const candidate = snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((entry) => ['approved', 'generated'].includes(String(entry.data.status)))
    .sort((a, b) =>
      String(b.data.updatedAt ?? b.data.createdAt ?? '').localeCompare(
        String(a.data.updatedAt ?? a.data.createdAt ?? ''),
      ),
    )[0];
  if (!candidate) return null;
  const pdfPath = String(candidate.data.pdfPath ?? '').trim();
  if (!pdfPath) return null;
  const ext = pdfPath.toLowerCase().includes('.pdf') ? 'pdf' : pdfPath.endsWith('.html') ? 'html' : 'pdf';
  return {
    key: reportType.toLowerCase() as OptionalAttachmentKey,
    filename: `${String(candidate.data.reportNumber ?? candidate.id)}.${ext}`,
    url: pdfPath,
  };
}

async function buildSchedulePdfAttachment(
  reportId: string,
  projectData: FirebaseFirestore.DocumentData,
  kind: 'pdm' | 'bar_chart' | 's_curve',
) {
  const projectName = String(projectData.name ?? 'Project');
  const projectId = String(projectData.projectId ?? projectData.id ?? '');

  if (kind === 's_curve') {
    const curveSnap = await db.collection('sCurves').doc(projectId).get();
    if (!curveSnap.exists) return null;
    const curve = curveSnap.data() ?? {};
    const points = Array.isArray(curve.points) ? curve.points : [];
    const pdf = await buildSimplePdf({
      title: 'S-Curve Summary',
      subtitle: projectName,
      meta: [
        ['Project', projectName],
        ['Generated', nowIso()],
      ],
      columns: ['Date', 'Target Plan', 'Actual'],
      rows: points.map((point) => {
        const row = point as Record<string, unknown>;
        return [
          String(row.date ?? ''),
          String(row.originalPlan ?? ''),
          String(row.actual ?? ''),
        ];
      }),
      footerNote: 'Attached after IAR approval by Engineers II, III, and IV.',
    });
    const url = await uploadPdfAttachment(`reports/${reportId}/attachments/s-curve.pdf`, pdf);
    return { key: kind, filename: 's-curve.pdf', url };
  }

  const scheduleSnap = await db.collection('schedules').doc(projectId).get();
  if (!scheduleSnap.exists) return null;
  const schedule = scheduleSnap.data() ?? {};

  if (kind === 'pdm') {
    const activities = Array.isArray(schedule.activities) ? schedule.activities : [];
    const pdf = await buildSimplePdf({
      title: 'PDM Schedule Summary',
      subtitle: projectName,
      meta: [
        ['Project', projectName],
        ['Generated', nowIso()],
      ],
      columns: ['Item No.', 'Activity', 'Duration', 'Critical'],
      rows: activities.map((activity) => {
        const row = activity as Record<string, unknown>;
        return [
          String(row.number ?? ''),
          String(row.name ?? ''),
          String(row.duration ?? ''),
          row.isCritical ? 'Yes' : 'No',
        ];
      }),
      footerNote: 'Attached after IAR approval by Engineers II, III, and IV.',
    });
    const url = await uploadPdfAttachment(`reports/${reportId}/attachments/pdm.pdf`, pdf);
    return { key: kind, filename: 'pdm.pdf', url };
  }

  const tasks = Array.isArray(schedule.barChartTasks) ? schedule.barChartTasks : [];
  const pdf = await buildSimplePdf({
    title: 'Bar Chart Summary',
    subtitle: projectName,
    meta: [
      ['Project', projectName],
      ['Generated', nowIso()],
    ],
    columns: ['#', 'Task', 'Start Day', 'End Day', 'Actual End'],
    rows: tasks.map((task) => {
      const row = task as Record<string, unknown>;
      return [
        String(row.index ?? ''),
        String(row.name ?? ''),
        String(row.startDay ?? ''),
        String(row.endDay ?? ''),
        String(row.actualEndDay ?? ''),
      ];
    }),
    footerNote: 'Attached after IAR approval by Engineers II, III, and IV.',
  });
  const url = await uploadPdfAttachment(`reports/${reportId}/attachments/bar-chart.pdf`, pdf);
  return { key: kind, filename: 'bar-chart.pdf', url };
}

async function buildOptionalAttachments(reportId: string, reportData: FirebaseFirestore.DocumentData) {
  const optionalAttachments = stringArray(reportData.releaseState?.optionalAttachments) as OptionalAttachmentKey[];
  const projectId = String(reportData.projectId ?? '');
  const projectSnap = await db.collection('projects').doc(projectId).get();
  const project = projectSnap.exists ? projectSnap.data() ?? {} : {};
  const generated = await Promise.all(
    optionalAttachments.map(async (key) => {
      if (key === 'swa') return resolveLatestApprovedReportFile(projectId, 'SWA');
      if (key === 'stewa') return resolveLatestApprovedReportFile(projectId, 'STEWA');
      return buildSchedulePdfAttachment(reportId, { ...project, projectId }, key as 'pdm' | 'bar_chart' | 's_curve');
    }),
  );
  const attachmentUrls: Record<string, string> = {};
  const mailAttachments: nodemailer.SendMailOptions['attachments'] = [];
  for (const entry of generated) {
    if (!entry) continue;
    attachmentUrls[entry.key] = entry.url;
    mailAttachments.push({ filename: entry.filename, path: entry.url });
  }
  return { attachmentUrls, mailAttachments, projectData: project };
}

function reportIsFullyApproved(data: FirebaseFirestore.DocumentData) {
  if (String(data.reportType) !== 'IAR') return true;
  const approvalFlow = (data.approvalFlow ?? {}) as Record<string, unknown>;
  const contractorConfirmation = (approvalFlow.contractorConfirmation ?? {}) as Record<string, unknown>;
  const engineer2 = approvalFlow.engineer2 as Record<string, unknown> | undefined;
  const engineer3 = approvalFlow.engineer3 as Record<string, unknown> | undefined;
  const engineer4 = approvalFlow.engineer4 as Record<string, unknown> | undefined;
  return (
    contractorConfirmation.confirmsSwa === true &&
    contractorConfirmation.confirmsIar === true &&
    Boolean(contractorConfirmation.confirmedAt) &&
    Boolean(engineer2?.approvedAt) &&
    Boolean(engineer3?.approvedAt) &&
    Boolean(engineer4?.approvedAt)
  );
}

async function buildReportEmailPayload(reportId: string, event: string) {
  const reportSnap = await db.collection('reports').doc(reportId).get();
  if (!reportSnap.exists) throw new Error('Report not found');
  const data = reportSnap.data()!;
  const projectId = String(data.projectId ?? '');
  const recipients = await resolveProjectRecipients(projectId);
  const subjectBase = `${String(data.reportType)} ${String(data.reportNumber ?? reportId)}`;
  const attachments: nodemailer.SendMailOptions['attachments'] = [];

  const subjectByEvent: Record<string, string> = {
    sent_to_contractor: `${subjectBase} sent to contractor`,
    submitted_for_review: `${subjectBase} submitted for Engineer II review`,
    forwarded_e3: `${subjectBase} forwarded to Engineer III`,
    forwarded_e4: `${subjectBase} forwarded to Engineer IV`,
    revision_requested: `${subjectBase} returned for correction`,
    final_approved: `${subjectBase} approved and released`,
  };
  const textByEvent: Record<string, string> = {
    sent_to_contractor: `The report is ready for contractor confirmation.\n\nProject: ${String(data.projectName ?? projectId)}`,
    submitted_for_review: `The report is now waiting for Engineer II review.\n\nProject: ${String(data.projectName ?? projectId)}`,
    forwarded_e3: `The report has been approved by Engineer II and is now with Engineer III.`,
    forwarded_e4: `The report has been approved by Engineer III and is now with Engineer IV.`,
    revision_requested: `A correction has been requested.\n\nReason: ${String(data.rejectionReason ?? 'Revision required.')}`,
    final_approved: `The IAR has been fully approved and released.\n\nProject: ${String(data.projectName ?? projectId)}\nReport: ${String(data.reportNumber ?? reportId)}`,
  };

  return {
    recipients,
    subject: `[ConstructFlow] ${subjectByEvent[event] ?? `${event} — ${subjectBase}`}`,
    text: textByEvent[event] ?? `Workflow event "${event}" for report ${reportId}.`,
    attachments,
  };
}

async function buildProjectEmailPayload(projectId: string, event: string) {
  const projectSnap = await db.collection('projects').doc(projectId).get();
  if (!projectSnap.exists) throw new Error('Project not found');
  const data = projectSnap.data()!;
  const accessSnapshot =
    (data.archivedAccessSnapshot as Record<string, unknown> | undefined) ?? data;
  const recipients = await resolveProjectRecipients(projectId, accessSnapshot);
  const projectName = String(data.name ?? projectId);

  const subjectByEvent: Record<string, string> = {
    project_archive_requested: `Archive approval requested for ${projectName}`,
    project_archive_approved: `Archive approval recorded for ${projectName}`,
    project_archived: `${projectName} moved to archive`,
    project_restored: `${projectName} restored from archive`,
  };
  const textByEvent: Record<string, string> = {
    project_archive_requested: `Engineer I requested deletion approval for ${projectName}.`,
    project_archive_approved: `A deletion approval step has been recorded for ${projectName}.`,
    project_archived: `${projectName} has been archived and can be restored for 21 days.`,
    project_restored: `${projectName} has been restored to active projects.`,
  };

  return {
    recipients,
    subject: `[ConstructFlow] ${subjectByEvent[event] ?? `${event} — ${projectName}`}`,
    text: textByEvent[event] ?? `Project workflow event "${event}" for ${projectName}.`,
    attachments: [] as nodemailer.SendMailOptions['attachments'],
  };
}

async function transporter() {
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) return null;
  return nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

type MailRecipient = { email: string; name: string };

function authenticatedMailbox() {
  return String(process.env.SMTP_USER || '').trim();
}

function mailFromHeader() {
  const mailbox = authenticatedMailbox();
  if (!mailbox) return process.env.MAIL_FROM || 'ConstructFlow <noreply@constructflow.local>';
  return `ConstructFlow <${mailbox}>`;
}

function rememberRecipient(list: MailRecipient[], email: string, name: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@') || list.some((item) => item.email === normalized)) return;
  const label = name.trim();
  list.push({ email: normalized, name: label || 'Project Stakeholder' });
}

async function sendToEachRecipient(
  smtp: nodemailer.Transporter,
  message: {
    recipients: MailRecipient[];
    subject: string;
    textFor: (recipient: MailRecipient) => string;
    htmlFor?: (recipient: MailRecipient) => string;
    attachments?: nodemailer.SendMailOptions['attachments'];
  },
) {
  const mailbox = authenticatedMailbox();
  const messageIds: string[] = [];
  for (const recipient of message.recipients) {
    const sent = await smtp.sendMail({
      from: mailFromHeader(),
      replyTo: mailbox || undefined,
      to: recipient.email,
      envelope: mailbox ? { from: mailbox, to: recipient.email } : undefined,
      subject: message.subject,
      text: message.textFor(recipient),
      html: message.htmlFor?.(recipient),
      attachments: message.attachments,
    });
    if (typeof sent.messageId === 'string') messageIds.push(sent.messageId);
  }
  return messageIds;
}

const FINAL_APPROVAL_ROLES = ['contractor', 'engineer_1', 'engineer_2', 'engineer_3', 'engineer_4'] as const;
const ATTACHMENT_LABELS: Record<OptionalAttachmentKey, string> = {
  pdm: 'PDM',
  bar_chart: 'Bar Chart',
  s_curve: 'S-Curve',
  swa: 'SWA',
  stewa: 'STEWA',
};
const EMAIL_CLAIM_STALE_MS = 10 * 60 * 1000;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isFinalApprovalReady(data: FirebaseFirestore.DocumentData) {
  const status = String(data.status ?? '');
  if (status !== 'approved' && status !== 'generated') return false;
  if (!String(data.pdfPath ?? '').trim()) return false;
  if (String(data.reportType) === 'IAR') return reportIsFullyApproved(data);
  return true;
}

function userCoversProject(data: FirebaseFirestore.DocumentData, projectId: string) {
  const accessible = stringArray(data.accessibleProjectIds);
  if (accessible.includes(projectId)) return true;
  const role = String(data.role ?? '');
  return (role === 'engineer_3' || role === 'engineer_4') && accessible.length === 0;
}

async function resolveFinalApprovalRecipients(projectId: string, project: FirebaseFirestore.DocumentData) {
  const recipients: MailRecipient[] = [];
  const coveredRoles = new Set<string>();
  const directIds = uniqueIds([
    typeof project.contractorId === 'string' ? project.contractorId : null,
    ...stringArray(project.assignedUserIds),
    ...stringArray(project.involvedUserIds),
    ...stringArray(project.accessUserIds),
  ]);
  if (directIds.length > 0) {
    const snaps = await db.getAll(...directIds.map((id) => db.collection('users').doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() ?? {};
      if (data.isActive === false) continue;
      const role = String(data.role ?? '');
      const email = String(data.email ?? '').trim();
      if (!email || !FINAL_APPROVAL_ROLES.includes(role as (typeof FINAL_APPROVAL_ROLES)[number])) continue;
      rememberRecipient(recipients, email, String(data.fullName ?? ''));
      coveredRoles.add(role);
    }
  }

  for (const role of ['engineer_3', 'engineer_4'] as const) {
    if (coveredRoles.has(role)) continue;
    const snap = await db.collection('users').where('role', '==', role).get();
    for (const userDoc of snap.docs) {
      const data = userDoc.data();
      if (data.isActive === false) continue;
      const email = String(data.email ?? '').trim();
      if (!email || !userCoversProject(data, projectId)) continue;
      rememberRecipient(recipients, email, String(data.fullName ?? ''));
    }
  }

  return recipients;
}

async function claimFinalApprovalSend(reportId: string, force = false) {
  const ref = db.collection('reports').doc(reportId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data()!;
    if (!isFinalApprovalReady(data)) return null;
    const status = String(data.emailStatus ?? 'NOT_SENT');
    if (status === 'SENT') return null;
    const claimedAt = Date.parse(String(data.emailClaimedAt ?? ''));
    const claimIsStale = !Number.isFinite(claimedAt) || Date.now() - claimedAt > EMAIL_CLAIM_STALE_MS;
    if (status === 'FAILED' && !force) return null;
    if (status === 'SENDING' && !force && !claimIsStale) return null;
    if (force && status !== 'FAILED' && !(status === 'SENDING' && claimIsStale)) return null;
    tx.set(
      ref,
      {
        emailStatus: 'SENDING',
        emailClaimedAt: nowIso(),
        emailError: null,
        updatedAt: nowIso(),
      },
      { merge: true },
    );
    return data;
  });
}

async function writeEmailNotification(entry: {
  reportId: string;
  projectId: string;
  recipients: string[];
  subject: string;
  attachments: string[];
  status: 'SENT' | 'FAILED';
  sentAt: string | null;
  error: string | null;
  messageId: string | null;
}) {
  await db.collection('emailNotifications').add({
    iarId: entry.reportId,
    reportId: entry.reportId,
    projectId: entry.projectId,
    recipients: entry.recipients,
    subject: entry.subject,
    attachments: entry.attachments,
    status: entry.status,
    createdAt: nowIso(),
    sentAt: entry.sentAt,
    error: entry.error,
    messageId: entry.messageId,
  });
}

async function markFinalEmailResult(
  reportId: string,
  result: {
    status: 'SENT' | 'FAILED';
    sentAt?: string | null;
    error?: string | null;
    messageId?: string | null;
    recipients?: string[];
  },
) {
  await db.collection('reports').doc(reportId).update({
    emailStatus: result.status,
    emailSentAt: result.sentAt ?? null,
    emailError: result.error ?? null,
    emailMessageId: result.messageId ?? null,
    emailRecipients: result.recipients ?? [],
    'releaseState.emailSentAt': result.status === 'SENT' ? result.sentAt ?? null : null,
    updatedAt: nowIso(),
  });
}

type FinalEmailResult = {
  sent: boolean;
  failed: boolean;
  skipped: boolean;
  reason?: string;
  recipients?: string[];
};

async function sendFinalApprovalEmail(reportId: string, force = false): Promise<FinalEmailResult> {
  const preview = await db.collection('reports').doc(reportId).get();
  if (!preview.exists) return { sent: false, failed: false, skipped: true, reason: 'Report not found' };
  if (!isFinalApprovalReady(preview.data()!)) {
    return { sent: false, failed: false, skipped: true, reason: 'Report is not fully approved' };
  }

  const claimed = await claimFinalApprovalSend(reportId, force);
  if (!claimed) {
    return { sent: false, failed: false, skipped: true, reason: 'Notification already sent or in progress' };
  }

  const projectId = String(claimed.projectId ?? '');
  let recipients: MailRecipient[] = [];
  let subject = '';
  let attachmentNames: string[] = [];

  try {
    const freshSnap = await db.collection('reports').doc(reportId).get();
    const data = freshSnap.data() ?? claimed;
    if (!isFinalApprovalReady(data)) {
      await markFinalEmailResult(reportId, {
        status: 'FAILED',
        error: 'Report was no longer fully approved when the email was prepared.',
      });
      return { sent: false, failed: true, skipped: false, reason: 'Approval changed' };
    }

    const projectSnap = await db.collection('projects').doc(projectId).get();
    if (!projectSnap.exists) throw new Error('Project not found');
    const project = projectSnap.data()!;
    recipients = await resolveFinalApprovalRecipients(projectId, project);
    if (recipients.length === 0) {
      throw new Error('No recipient email addresses are stored for the users assigned to this project.');
    }

    const smtp = await transporter();
    if (!smtp) {
      throw new Error('Email transport is not configured. Set SMTP_HOST on Cloud Functions.');
    }

    const pdfUrl = String(data.pdfPath ?? '').trim();
    if (!pdfUrl) throw new Error('Approved report PDF is not available.');
    const reportType = String(data.reportType ?? 'IAR');
    const reportNumber = String(data.reportNumber ?? reportId);
    const projectName = String(project.name ?? data.projectName ?? projectId);
    const optional = await buildOptionalAttachments(reportId, data);
    const selectedLabels = stringArray(data.releaseState?.optionalAttachments)
      .map((key) => ATTACHMENT_LABELS[key as OptionalAttachmentKey])
      .filter((label): label is string => Boolean(label));
    subject = `ConstructFlow - Project Approved - ${projectName}`;
    const extraLine = selectedLabels.length > 0 ? selectedLabels.join('\n') : 'None';
    const extraHtml =
      selectedLabels.length > 0 ? selectedLabels.map((label) => escapeHtml(label)).join('<br>') : 'None';
    const textFor = (recipient: MailRecipient) =>
      [
        `Dear ${recipient.name},`,
        '',
        'The following ConstructFlow project has completed the required approval workflow:',
        '',
        'Project:',
        projectName,
        '',
        'Status:',
        'APPROVED',
        '',
        'The project has been fully approved by the required approving personnel.',
        '',
        `The approved ${reportType} report is attached.`,
        '',
        'Additional reports attached:',
        extraLine,
        '',
        'Regards,',
        '',
        'ConstructFlow',
        "Provincial Engineer's Office",
        'Construction Division',
      ].join('\n');
    const htmlFor = (recipient: MailRecipient) => `
      <p>Dear ${escapeHtml(recipient.name)},</p>
      <p>The following ConstructFlow project has completed the required approval workflow:</p>
      <p><strong>Project:</strong><br>${escapeHtml(projectName)}</p>
      <p><strong>Status:</strong><br>APPROVED</p>
      <p>The project has been fully approved by the required approving personnel.</p>
      <p>The approved ${escapeHtml(reportType)} report is attached.</p>
      <p><strong>Additional reports attached:</strong><br>${extraHtml}</p>
      <p>Regards,</p>
      <p><strong>ConstructFlow</strong><br>Provincial Engineer's Office<br>Construction Division</p>
    `;

    const attachments: nodemailer.SendMailOptions['attachments'] = [
      { filename: `${reportNumber}.pdf`, path: pdfUrl },
      ...(optional.mailAttachments ?? []),
    ];
    attachmentNames = attachments
      .map((item) => (typeof item.filename === 'string' ? item.filename : ''))
      .filter((name) => name.length > 0);

    const messageIds = await sendToEachRecipient(smtp, {
      recipients,
      subject,
      textFor,
      htmlFor,
      attachments,
    });
    const sentAt = nowIso();
    const messageId = messageIds[0] ?? null;
    const recipientEmails = recipients.map((recipient) => recipient.email);
    await markFinalEmailResult(reportId, {
      status: 'SENT',
      sentAt,
      error: null,
      messageId,
      recipients: recipientEmails,
    });
    if (optional.attachmentUrls && Object.keys(optional.attachmentUrls).length > 0) {
      await db.collection('reports').doc(reportId).update({
        'releaseState.attachmentUrls': optional.attachmentUrls,
        updatedAt: nowIso(),
      });
    }
    await writeEmailNotification({
      reportId,
      projectId,
      recipients: recipientEmails,
      subject,
      attachments: attachmentNames,
      status: 'SENT',
      sentAt,
      error: null,
      messageId,
    });
    await writeReportAudit(reportId, 'release_notified', {
      recipients: recipientEmails,
      attachmentKeys: Object.keys(optional.attachmentUrls ?? {}),
      messageId,
    });
    return { sent: true, failed: false, skipped: false, recipients: recipientEmails };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const recipientEmails = recipients.map((recipient) => recipient.email);
    await markFinalEmailResult(reportId, { status: 'FAILED', error, recipients: recipientEmails });
    await writeEmailNotification({
      reportId,
      projectId,
      recipients: recipientEmails,
      subject: subject || `ConstructFlow - Project approved - ${projectId}`,
      attachments: attachmentNames,
      status: 'FAILED',
      sentAt: null,
      error,
      messageId: null,
    });
    await writeReportAudit(reportId, 'release_email_failed', { error });
    return { sent: false, failed: true, skipped: false, reason: error, recipients: recipientEmails };
  }
}

async function processQueuedEmail(
  queueRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
) {
  const reportId = typeof data.reportId === 'string' ? data.reportId : '';
  const projectId = typeof data.projectId === 'string' ? data.projectId : '';
  const event = String(data.event ?? '');

  if (reportId && event === 'final_approved') {
    const result = await sendFinalApprovalEmail(reportId);
    await queueRef.set(
      {
        status: result.sent ? 'sent' : result.failed ? 'failed' : 'skipped',
        reason: result.reason ?? null,
        sentAt: result.sent ? nowIso() : null,
        recipientEmails: result.recipients ?? [],
        updatedAt: nowIso(),
      },
      { merge: true },
    );
    return { ok: !result.failed, skipped: result.skipped };
  }

  const smtp = await transporter();
  if (!smtp) {
    await queueRef.set({ status: 'skipped', reason: 'SMTP not configured', updatedAt: nowIso() }, { merge: true });
    return { ok: true, skipped: true };
  }

  const payload = reportId
    ? await buildReportEmailPayload(reportId, event)
    : await buildProjectEmailPayload(projectId, event);

  const recipients = uniqueIds(payload.recipients).map((email) => ({
    email,
    name: 'Project Stakeholder',
  }));
  const fallback = process.env.MAIL_TO || process.env.SMTP_USER || '';
  const addressed = recipients.length > 0 ? recipients : fallback ? [{ email: fallback, name: 'Project Stakeholder' }] : [];
  if (addressed.length === 0) {
    await queueRef.set({ status: 'skipped', reason: 'No recipients', updatedAt: nowIso() }, { merge: true });
    return { ok: true, skipped: true };
  }

  await sendToEachRecipient(smtp, {
    recipients: addressed,
    subject: payload.subject,
    textFor: () => payload.text,
    attachments: payload.attachments,
  });

  await queueRef.set(
    {
      status: 'sent',
      sentAt: nowIso(),
      recipientEmails: addressed.map((recipient) => recipient.email),
      attachmentCount: payload.attachments?.length ?? 0,
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  return { ok: true };
}

export const seedDemoData = onCall({ invoker: 'public' }, async () => {
  const now = nowIso();
  const usersByEmail = new Map<string, { uid: string; role: string; fullName: string }>();

  for (const account of ACCOUNTS) {
    let uid: string;
    try {
      const created = await admin.auth().createUser({
        email: account.email,
        password: account.password,
        displayName: account.fullName,
      });
      uid = created.uid;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== 'auth/email-already-exists') throw err;
      const existing = await admin.auth().getUserByEmail(account.email);
      uid = existing.uid;
      await admin.auth().updateUser(uid, {
        email: account.email,
        password: account.password,
        displayName: account.fullName,
        disabled: false,
      });
    }
    usersByEmail.set(account.email, { uid, role: account.role, fullName: account.fullName });
  }

  const allProjectIds = PROJECT_SPECS.map((project) => project.id);
  for (const account of ACCOUNTS) {
    const user = usersByEmail.get(account.email)!;
    const assignedProjectIds = PROJECT_SPECS
      .filter((project) => project.contractorEmail === account.email || project.engineer1Email === account.email)
      .map((project) => project.id);
    const involvedProjectIds = PROJECT_SPECS
      .filter((project) => project.engineer2Emails.some((email) => email === account.email))
      .map((project) => project.id);
    const accessibleProjectIds =
      account.role === 'engineer_3' || account.role === 'engineer_4'
        ? allProjectIds
        : uniqueIds([...assignedProjectIds, ...involvedProjectIds]);

    await db.collection('users').doc(user.uid).set(
      {
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        isActive: true,
        isTestAccount: admin.firestore.FieldValue.delete(),
        isDevelopmentAccount: admin.firestore.FieldValue.delete(),
        accountType: admin.firestore.FieldValue.delete(),
        notes: admin.firestore.FieldValue.delete(),
        assignedProjectIds,
        involvedProjectIds,
        accessibleProjectIds,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );
  }

  for (const project of PROJECT_SPECS) {
    const contractor = usersByEmail.get(project.contractorEmail);
    const engineer1 = usersByEmail.get(project.engineer1Email);
    const engineer2Uids = project.engineer2Emails
      .map((email) => usersByEmail.get(email)?.uid ?? null)
      .filter((uid): uid is string => Boolean(uid));
    const access = buildProjectAccess({
      contractorId: contractor?.uid ?? null,
      assignedUserIds: [engineer1?.uid ?? null].filter((uid): uid is string => Boolean(uid)),
      involvedUserIds: engineer2Uids,
    });
    await db.collection('projects').doc(project.id).set(
      {
        name: project.name,
        location: project.location,
        status: project.status,
        lifecycleState: 'active',
        startDate: project.startDate,
        plannedEndDate: project.plannedEndDate,
        contractAmount: project.contractAmount,
        contractorId: access.contractorId,
        contractorName: contractor?.fullName ?? null,
        assignedUserIds: access.assignedUserIds,
        involvedUserIds: access.involvedUserIds,
        accessUserIds: access.accessUserIds,
        isTestProject: admin.firestore.FieldValue.delete(),
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    await db.collection('schedules').doc(project.id).set(
      {
        projectId: project.id,
        activities: [],
        dependencies: [],
        barChartTasks: [],
        barChartTotalDays: 1,
        barChartTimeNow: 0,
        projectDuration: 0,
        criticalPath: [],
        updatedAt: now,
      },
      { merge: true },
    );
  }

  const projectsSnap = await db.collection('projects').get();
  const projectAccessById = new Map<string, { accessUserIds: string[] }>();
  const projectAccessWrites: Array<Promise<FirebaseFirestore.WriteResult>> = [];
  projectsSnap.forEach((projectDoc) => {
    const data = projectDoc.data();
    const access = buildProjectAccess({
      contractorId: typeof data.contractorId === 'string' ? data.contractorId : null,
      assignedUserIds: Array.isArray(data.assignedUserIds) ? data.assignedUserIds : [],
      involvedUserIds: Array.isArray(data.involvedUserIds) ? data.involvedUserIds : [],
    });
    projectAccessById.set(projectDoc.id, { accessUserIds: access.accessUserIds });
    projectAccessWrites.push(
      projectDoc.ref.set(
        {
          lifecycleState: data.lifecycleState ?? 'active',
          contractorId: access.contractorId,
          assignedUserIds: access.assignedUserIds,
          involvedUserIds: access.involvedUserIds,
          accessUserIds: access.accessUserIds,
          updatedAt: now,
        },
        { merge: true },
      ),
    );
  });
  await Promise.all(projectAccessWrites);

  const reportsSnap = await db.collection('reports').get();
  const reportWrites: Array<Promise<FirebaseFirestore.WriteResult>> = [];
  const counterNextSuffix = new Map<string, number>();
  reportsSnap.forEach((reportDoc) => {
    const data = reportDoc.data();
    const projectId = String(data.projectId ?? '');
    const projectAccess = projectAccessById.get(projectId);
    const reportNumber = String(data.reportNumber ?? '');
    if (reportNumber) {
      const parsed = parseReportNumberCounter(reportNumber);
      const prev = counterNextSuffix.get(parsed.base) ?? 1;
      counterNextSuffix.set(parsed.base, Math.max(prev, parsed.nextSuffix));
    }
    if (!projectAccess) return;
    reportWrites.push(
      reportDoc.ref.set(
        {
          accessUserIds: projectAccess.accessUserIds,
          updatedAt: now,
        },
        { merge: true },
      ),
    );
  });
  const counterWrites = [...counterNextSuffix.entries()].map(([base, nextSuffix]) =>
    db.collection('counters').doc(`reportNumber_${base}`).set(
      {
        kind: 'report_number',
        base,
        nextSuffix,
        updatedAt: now,
      },
      { merge: true },
    ),
  );
  await Promise.all([...reportWrites, ...counterWrites]);

  return {
    ok: true,
    users: ACCOUNTS.length,
    projects: PROJECT_SPECS.length,
    reportsUpdated: reportWrites.length,
    countersUpdated: counterWrites.length,
  };
});

function isDemoOrSampleProjectId(projectId: string) {
  return projectId.startsWith('demo-') || projectId.startsWith('sample-');
}

async function purgeProjectTree(projectId: string) {
  const reportSnap = await db.collection('reports').where('projectId', '==', projectId).get();
  for (const reportDoc of reportSnap.docs) {
    await db.recursiveDelete(reportDoc.ref);
  }

  const scheduleRef = db.collection('schedules').doc(projectId);
  if ((await scheduleRef.get()).exists) await db.recursiveDelete(scheduleRef);

  const sCurveRef = db.collection('sCurves').doc(projectId);
  if ((await sCurveRef.get()).exists) await db.recursiveDelete(sCurveRef);

  const projectRef = db.collection('projects').doc(projectId);
  if ((await projectRef.get()).exists) await db.recursiveDelete(projectRef);
}

/**
 * Removes seeded demo/sample project data while keeping Auth users and user profile docs.
 */
export const clearDemoData = onCall({ invoker: 'public' }, async () => {
  const now = nowIso();
  const projectsSnap = await db.collection('projects').get();
  const demoProjectIds = projectsSnap.docs
    .map((projectDoc) => projectDoc.id)
    .filter((id) => isDemoOrSampleProjectId(id));

  // Also catch known seed ids even if the project doc was already removed.
  for (const spec of PROJECT_SPECS) {
    if (!demoProjectIds.includes(spec.id)) demoProjectIds.push(spec.id);
  }

  let reportsDeleted = 0;
  const reportsSnap = await db.collection('reports').get();
  for (const reportDoc of reportsSnap.docs) {
    const data = reportDoc.data();
    const projectId = String(data.projectId ?? '');
    const reportNumber = String(data.reportNumber ?? '');
    const projectName = String(data.projectName ?? '');
    const isDemoReport =
      isDemoOrSampleProjectId(projectId)
      || reportDoc.id.startsWith('sample-')
      || reportDoc.id.startsWith('demo-')
      || /sample/i.test(reportNumber)
      || /sample/i.test(projectName);
    if (!isDemoReport) continue;
    await db.recursiveDelete(reportDoc.ref);
    reportsDeleted += 1;
  }

  let projectsDeleted = 0;
  for (const projectId of demoProjectIds) {
    await purgeProjectTree(projectId);
    projectsDeleted += 1;
  }

  let emailQueueDeleted = 0;
  const emailSnap = await db.collection('emailQueue').get();
  for (const emailDoc of emailSnap.docs) {
    const data = emailDoc.data();
    const projectId = String(data.projectId ?? '');
    const reportId = String(data.reportId ?? '');
    if (
      isDemoOrSampleProjectId(projectId)
      || reportId.startsWith('sample-')
      || reportId.startsWith('demo-')
      || /sample/i.test(String(data.event ?? ''))
    ) {
      await emailDoc.ref.delete();
      emailQueueDeleted += 1;
    }
  }

  let countersDeleted = 0;
  const countersSnap = await db.collection('counters').get();
  for (const counterDoc of countersSnap.docs) {
    const base = String(counterDoc.data().base ?? counterDoc.id);
    if (/sample/i.test(base) || /demo-/i.test(base) || counterDoc.id.includes('sample')) {
      await counterDoc.ref.delete();
      countersDeleted += 1;
    }
  }

  const demoIdSet = new Set(demoProjectIds);
  const stripDemoIds = (value: unknown) =>
    stringArray(value).filter((id) => !demoIdSet.has(id) && !isDemoOrSampleProjectId(id));

  let usersUpdated = 0;
  const usersSnap = await db.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const assignedProjectIds = stripDemoIds(data.assignedProjectIds);
    const involvedProjectIds = stripDemoIds(data.involvedProjectIds);
    const accessibleProjectIds = stripDemoIds(data.accessibleProjectIds);
    const changed =
      JSON.stringify(assignedProjectIds) !== JSON.stringify(stringArray(data.assignedProjectIds))
      || JSON.stringify(involvedProjectIds) !== JSON.stringify(stringArray(data.involvedProjectIds))
      || JSON.stringify(accessibleProjectIds) !== JSON.stringify(stringArray(data.accessibleProjectIds));
    if (!changed) continue;
    await userDoc.ref.set(
      {
        assignedProjectIds,
        involvedProjectIds,
        accessibleProjectIds,
        updatedAt: now,
      },
      { merge: true },
    );
    usersUpdated += 1;
  }

  return {
    ok: true,
    accountsPreserved: ACCOUNTS.length,
    projectsDeleted,
    reportsDeleted,
    emailQueueDeleted,
    countersDeleted,
    usersUpdated,
  };
});

export const finalizeReport = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const reportId = String(request.data?.reportId ?? '');
  if (!reportId) throw new HttpsError('invalid-argument', 'reportId required');

  const ref = db.collection('reports').doc(reportId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Report not found');
  const data = snap.data()!;
  if (!reportIsFullyApproved(data)) {
    throw new HttpsError('failed-precondition', 'IAR approvals are incomplete.');
  }
  const reportNumber = String(data.reportNumber ?? reportId);
  const qrCode = reportNumber;

  const pdfBuffer = await buildSimplePdf({
    title: `${String(data.reportType)} — Final Report`,
    subtitle: 'Approved report certificate',
    meta: [
      ['Report Number', reportNumber],
      ['Project', String(data.projectName ?? data.projectId)],
      ['Status', 'Generated'],
      ['Verification code', qrCode],
      ['Generated at', nowIso()],
    ],
    footerNote:
      'This PDF is released only after Contractor confirmation and approval by Engineers II, III, and IV.',
  });

  const path = `reports/${reportId}/${reportNumber}.pdf`;
  const pdfUrl = await uploadPdfAttachment(path, pdfBuffer);

  await ref.set(
    {
      status: 'generated',
      pdfPath: pdfUrl,
      qrCode,
      generatedAt: nowIso(),
      updatedAt: nowIso(),
    },
    { merge: true },
  );

  await writeReportAudit(reportId, 'finalized', { pdfUrl, qrCode });
  return { pdf_url: pdfUrl, qr_code: qrCode };
});

export const sendWorkflowEmail = onCall(async (request) => {
  const reportId = String(request.data?.reportId ?? '');
  const projectId = String(request.data?.projectId ?? '');
  const event = String(request.data?.event ?? '');
  if (!event || (!reportId && !projectId)) {
    throw new HttpsError('invalid-argument', 'event and reportId/projectId required');
  }

  const queueRef = await db.collection('emailQueue').add({
    reportId: reportId || null,
    projectId: projectId || null,
    event,
    status: 'processing',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  try {
    return await processQueuedEmail(queueRef, { reportId, projectId, event });
  } catch (err) {
    await queueRef.set(
      {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        updatedAt: nowIso(),
      },
      { merge: true },
    );
    throw new HttpsError('internal', 'Email send failed');
  }
});

export const onReportFullyApproved = onDocumentUpdated('reports/{reportId}', async (event) => {
  const after = event.data?.after.data();
  if (!after || !isFinalApprovalReady(after)) return;
  const emailStatus = String(after.emailStatus ?? 'NOT_SENT');
  if (emailStatus === 'SENT' || emailStatus === 'FAILED' || emailStatus === 'SENDING') return;
  await sendFinalApprovalEmail(event.params.reportId);
});

export const retryApprovalEmail = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const reportId = String(request.data?.reportId ?? '');
  if (!reportId) throw new HttpsError('invalid-argument', 'reportId required');

  const reportSnap = await db.collection('reports').doc(reportId).get();
  if (!reportSnap.exists) throw new HttpsError('not-found', 'Report not found');
  const report = reportSnap.data()!;
  if (!isFinalApprovalReady(report)) {
    throw new HttpsError('failed-precondition', 'Report is not fully approved');
  }

  const projectId = String(report.projectId ?? '');
  const projectSnap = await db.collection('projects').doc(projectId).get();
  if (!projectSnap.exists) throw new HttpsError('not-found', 'Project not found');
  await assertCanRetryApprovalEmail(request.auth.uid, projectId, projectSnap.data()!);

  const current = String(report.emailStatus ?? 'NOT_SENT');
  const claimedAt = Date.parse(String(report.emailClaimedAt ?? ''));
  const claimIsStale = !Number.isFinite(claimedAt) || Date.now() - claimedAt > EMAIL_CLAIM_STALE_MS;
  if (current === 'SENT') {
    throw new HttpsError('failed-precondition', 'This notification was already sent');
  }
  if (current !== 'FAILED' && !(current === 'SENDING' && claimIsStale)) {
    throw new HttpsError('failed-precondition', 'This notification cannot be retried yet');
  }

  const result = await sendFinalApprovalEmail(reportId, true);
  if (result.failed) {
    throw new HttpsError('internal', result.reason || 'Email send failed');
  }
  if (!result.sent) {
    throw new HttpsError('failed-precondition', result.reason || 'Notification was not sent');
  }
  return { emailStatus: 'SENT' };
});

async function assertCanRetryApprovalEmail(
  uid: string,
  projectId: string,
  project: FirebaseFirestore.DocumentData,
) {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new HttpsError('permission-denied', 'User profile not found');
  const role = String(userSnap.data()?.role ?? '');
  if (!['engineer_2', 'engineer_3', 'engineer_4'].includes(role)) {
    throw new HttpsError('permission-denied', 'You cannot retry this notification');
  }
  if (role === 'engineer_3' || role === 'engineer_4') return;
  const involved = stringArray(project.involvedUserIds);
  const access = stringArray(project.accessUserIds);
  const accessible = stringArray(userSnap.data()?.accessibleProjectIds);
  if (involved.includes(uid) || access.includes(uid) || accessible.includes(projectId)) return;
  throw new HttpsError('permission-denied', 'You are not assigned to this project');
}

export const onEmailQueueCreated = onDocumentCreated('emailQueue/{id}', async (event) => {
  const data = event.data?.data();
  if (!data || data.status !== 'queued') return;
  await event.data?.ref.set({ status: 'processing', updatedAt: nowIso() }, { merge: true });
  try {
    await processQueuedEmail(event.data!.ref, data);
  } catch (err) {
    await event.data?.ref.set(
      {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        updatedAt: nowIso(),
      },
      { merge: true },
    );
  }
});

export const purgeArchivedProjects = onSchedule({ schedule: 'every day 02:30' }, async () => {
  const archived = await db.collection('projects').where('lifecycleState', '==', 'archived').get();
  const now = Date.now();
  let purged = 0;

  for (const projectDoc of archived.docs) {
    const data = projectDoc.data();
    const purgeAfter = String(data.purgeAfter ?? '');
    if (!purgeAfter || Number.isNaN(Date.parse(purgeAfter)) || Date.parse(purgeAfter) > now) {
      continue;
    }

    const reportSnap = await db.collection('reports').where('projectId', '==', projectDoc.id).get();
    for (const reportDoc of reportSnap.docs) {
      await db.recursiveDelete(reportDoc.ref);
    }

    const scheduleRef = db.collection('schedules').doc(projectDoc.id);
    if ((await scheduleRef.get()).exists) await db.recursiveDelete(scheduleRef);
    const sCurveRef = db.collection('sCurves').doc(projectDoc.id);
    if ((await sCurveRef.get()).exists) await db.recursiveDelete(sCurveRef);

    await writeProjectAudit(projectDoc.id, 'lifecycleState', 'archived', 'purged');
    await db.recursiveDelete(projectDoc.ref);
    purged += 1;
  }

  console.log('purgeArchivedProjects', { purged });
});

export const verifyReport = onCall({ invoker: 'public' }, async (request) => {
  const qr = String(request.data?.qr ?? request.data?.reportNumber ?? '');
  if (!qr) throw new HttpsError('invalid-argument', 'qr required');
  let snap = await db.collection('reports').where('qrCode', '==', qr).limit(1).get();
  if (snap.empty) {
    snap = await db.collection('reports').where('reportNumber', '==', qr).limit(1).get();
  }
  if (snap.empty) return { valid: false, message: 'Invalid QR code' };
  const doc = snap.docs[0];
  const data = doc.data();
  const verified = ['approved', 'generated'].includes(String(data.status));
  return {
    valid: verified,
    verified,
    report: { id: doc.id, ...data },
    message: verified ? 'Report verified' : 'Report found but not yet approved',
  };
});
