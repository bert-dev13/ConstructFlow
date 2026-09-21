import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as nodemailer from 'nodemailer';

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

const DEMO_USERS: Array<{
  email: string;
  password: string;
  fullName: string;
  role: string;
}> = [
  { email: 'engineer1@gmail.com', password: 'engineer123', fullName: 'Engineer I', role: 'engineer_1' },
  { email: 'engineer2@gmail.com', password: 'engineer123', fullName: 'Engineer II', role: 'engineer_2' },
  { email: 'engineer3@gmail.com', password: 'engineer123', fullName: 'Engineer III', role: 'engineer_3' },
  { email: 'engineer4@gmail.com', password: 'engineer123', fullName: 'Engineer IV', role: 'engineer_4' },
  { email: 'contractor@gmail.com', password: 'engineer123', fullName: 'Contractor', role: 'contractor' },
];

export const seedDemoData = onCall({ invoker: 'public' }, async () => {
  const contractorUids: string[] = [];

  for (const account of DEMO_USERS) {
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
    }
    await db.collection('users').doc(uid).set(
      {
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        isActive: true,
        createdAt: new Date().toISOString(),
      },
      { merge: true },
    );
    if (account.role === 'contractor') contractorUids.push(uid);
  }

  const projects = [
    {
      id: 'demo-capitol-annex',
      name: 'Provincial Capitol Annex',
      location: 'Tuguegarao City, Cagayan',
      status: 'active',
      startDate: '2025-07-01',
      plannedEndDate: '2025-10-19',
      contractAmount: 5991119.01,
      contractorId: contractorUids[0] ?? null,
      contractorName: 'Contractor',
    },
    {
      id: 'demo-remebella-road',
      name: 'Remebella Road Improvement',
      location: 'Remebella, Buguey, Cagayan',
      status: 'active',
      startDate: '2025-07-01',
      plannedEndDate: '2025-10-19',
      contractAmount: 5991119.01,
      contractorId: contractorUids[0] ?? null,
      contractorName: 'Contractor',
    },
    {
      id: 'demo-north-zone-pipe',
      name: 'North Zone Pipe Replacement',
      location: 'North Zone, Cagayan',
      status: 'active',
      startDate: '2025-08-01',
      plannedEndDate: '2025-12-15',
      contractAmount: 2500000,
      contractorId: contractorUids[0] ?? null,
      contractorName: 'Contractor',
    },
  ];

  for (const p of projects) {
    const { id, ...rest } = p;
    await db.collection('projects').doc(id).set(
      { ...rest, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { merge: true },
    );
    await db.collection('schedules').doc(id).set(
      {
        projectId: id,
        activities: [],
        dependencies: [],
        barChartTasks: [],
        barChartTotalDays: 1,
        barChartTimeNow: 0,
        projectDuration: 0,
        criticalPath: [],
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  return { ok: true, users: DEMO_USERS.length, projects: projects.length };
});

export const finalizeReport = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const reportId = String(request.data?.reportId ?? '');
  if (!reportId) throw new HttpsError('invalid-argument', 'reportId required');

  const ref = db.collection('reports').doc(reportId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Report not found');
  const data = snap.data()!;
  const reportNumber = String(data.reportNumber ?? reportId);
  const qrCode = reportNumber;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${reportNumber}</title></head>
  <body style="font-family:Georgia,serif;padding:48px;color:#111">
    <h1 style="color:#0B3D2E">ConstructFlow</h1>
    <h2>${String(data.reportType)} — Final Report</h2>
    <p><strong>Report Number:</strong> ${reportNumber}</p>
    <p><strong>Project:</strong> ${String(data.projectName ?? data.projectId)}</p>
    <p><strong>Status:</strong> Generated</p>
    <p><strong>Verification code:</strong> ${qrCode}</p>
    <p>Generated at ${new Date().toISOString()}</p>
  </body></html>`;

  const path = `reports/${reportId}/${reportNumber}.html`;
  const file = bucket.file(path);
  await file.save(html, { contentType: 'text/html', public: true });
  const pdfUrl = `https://storage.googleapis.com/${bucket.name}/${path}`;

  await ref.set(
    {
      status: 'generated',
      pdfPath: pdfUrl,
      qrCode,
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return { pdf_url: pdfUrl, qr_code: qrCode };
});

export const sendWorkflowEmail = onCall(async (request) => {
  const reportId = String(request.data?.reportId ?? '');
  const event = String(request.data?.event ?? '');
  if (!reportId) throw new HttpsError('invalid-argument', 'reportId required');

  const queueRef = await db.collection('emailQueue').add({
    reportId,
    event,
    status: 'processing',
    createdAt: new Date().toISOString(),
  });

  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    await queueRef.update({ status: 'skipped', reason: 'SMTP not configured' });
    return { ok: true, skipped: true };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transporter.sendMail({
      from: process.env.MAIL_FROM || 'noreply@constructflow.local',
      to: process.env.MAIL_TO || process.env.SMTP_USER || 'noreply@constructflow.local',
      subject: `[ConstructFlow] ${event} — report ${reportId}`,
      text: `Workflow event "${event}" for report ${reportId}.`,
    });
    await queueRef.update({ status: 'sent', sentAt: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    await queueRef.update({
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    throw new HttpsError('internal', 'Email send failed');
  }
});

export const onEmailQueueCreated = onDocumentCreated('emailQueue/{id}', async (event) => {
  const data = event.data?.data();
  if (!data || data.status !== 'queued') return;
  // Marker for extension / future SMTP worker
  await event.data?.ref.set({ seenByFunction: true }, { merge: true });
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
