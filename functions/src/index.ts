import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
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
  { email: 'constructflow.contractor.1@gmail.com', password: 'contractor123', fullName: 'Contractor Alpha', role: 'contractor' },
  { email: 'constructflow.contractor.2@gmail.com', password: 'contractor123', fullName: 'Contractor Bravo', role: 'contractor' },
  { email: 'constructflow.contractor.3@gmail.com', password: 'contractor123', fullName: 'Contractor Charlie', role: 'contractor' },
  { email: 'constructflow.engineer1.1@gmail.com', password: 'engineer123', fullName: 'Engr. Juan Dela Cruz', role: 'engineer_1' },
  { email: 'constructflow.engineer1.2@gmail.com', password: 'engineer123', fullName: 'Engr. Carlos Mendoza', role: 'engineer_1' },
  { email: 'constructflow.engineer1.3@gmail.com', password: 'engineer123', fullName: 'Engr. Sofia Ramirez', role: 'engineer_1' },
  { email: 'constructflow.engineer2.1@gmail.com', password: 'engineer123', fullName: 'Engr. Maria Santos', role: 'engineer_2' },
  { email: 'constructflow.engineer2.2@gmail.com', password: 'engineer123', fullName: 'Engr. Luis Garcia', role: 'engineer_2' },
  { email: 'constructflow.engineer2.3@gmail.com', password: 'engineer123', fullName: 'Engr. Elena Cruz', role: 'engineer_2' },
  { email: 'constructflow.engineer3.1@gmail.com', password: 'engineer123', fullName: 'Engr. Pedro Reyes', role: 'engineer_3' },
  { email: 'constructflow.engineer4.1@gmail.com', password: 'engineer123', fullName: 'Engr. Ana Lopez', role: 'engineer_4' },
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
    engineer1Email: 'constructflow.engineer1.1@gmail.com',
    engineer2Emails: ['constructflow.engineer2.1@gmail.com'],
  },
  {
    id: 'demo-remebella-road',
    name: 'Remebella Road Improvement',
    location: 'Remebella, Buguey, Cagayan',
    status: 'active',
    startDate: '2025-07-01',
    plannedEndDate: '2025-10-19',
    contractAmount: 5991119.01,
    contractorEmail: 'constructflow.contractor.2@gmail.com',
    engineer1Email: 'constructflow.engineer1.2@gmail.com',
    engineer2Emails: ['constructflow.engineer2.2@gmail.com'],
  },
  {
    id: 'demo-north-zone-pipe',
    name: 'North Zone Pipe Replacement',
    location: 'North Zone, Cagayan',
    status: 'active',
    startDate: '2025-08-01',
    plannedEndDate: '2025-12-15',
    contractAmount: 2500000,
    contractorEmail: 'constructflow.contractor.3@gmail.com',
    engineer1Email: 'constructflow.engineer1.3@gmail.com',
    engineer2Emails: ['constructflow.engineer2.3@gmail.com'],
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
  const attachmentUrls: Record<string, string> = {};

  if (event === 'final_approved') {
    const reportFile = String(data.pdfPath ?? '').trim();
    if (reportFile) {
      attachments.push({
        filename: `${String(data.reportNumber ?? reportId)}.${
          reportFile.toLowerCase().includes('.pdf') ? 'pdf' : reportFile.endsWith('.html') ? 'html' : 'pdf'
        }`,
        path: reportFile,
      });
    }
    const optional = await buildOptionalAttachments(reportId, data);
    attachments.push(...(optional.mailAttachments ?? []));
    Object.assign(attachmentUrls, optional.attachmentUrls);
    await reportSnap.ref.set(
      {
        releaseState: {
          ...(data.releaseState ?? {}),
          attachmentUrls,
          emailSentAt: nowIso(),
        },
        updatedAt: nowIso(),
      },
      { merge: true },
    );
    await writeReportAudit(reportId, 'release_notified', {
      recipients,
      attachmentKeys: Object.keys(attachmentUrls),
    });
  }

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

async function processQueuedEmail(
  queueRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
) {
  const smtp = await transporter();
  if (!smtp) {
    await queueRef.set({ status: 'skipped', reason: 'SMTP not configured', updatedAt: nowIso() }, { merge: true });
    return { ok: true, skipped: true };
  }

  const reportId = typeof data.reportId === 'string' ? data.reportId : '';
  const projectId = typeof data.projectId === 'string' ? data.projectId : '';
  const event = String(data.event ?? '');
  const payload = reportId
    ? await buildReportEmailPayload(reportId, event)
    : await buildProjectEmailPayload(projectId, event);

  const recipients = uniqueIds(payload.recipients);
  const mailTo =
    recipients.length > 0
      ? recipients.join(', ')
      : process.env.MAIL_TO || process.env.SMTP_USER || 'noreply@constructflow.local';

  await smtp.sendMail({
    from: process.env.MAIL_FROM || 'noreply@constructflow.local',
    to: mailTo,
    subject: payload.subject,
    text: payload.text,
    attachments: payload.attachments,
  });

  await queueRef.set(
    {
      status: 'sent',
      sentAt: nowIso(),
      recipientEmails: recipients,
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
