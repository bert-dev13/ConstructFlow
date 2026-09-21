"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyReport = exports.onEmailQueueCreated = exports.sendWorkflowEmail = exports.finalizeReport = exports.seedDemoData = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const nodemailer = __importStar(require("nodemailer"));
admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();
const DEMO_USERS = [
    { email: 'constructflow.engineer1.1@gmail.com', password: 'demo123', fullName: 'Engr. Juan Dela Cruz', role: 'engineer_1' },
    { email: 'constructflow.engineer1.2@gmail.com', password: 'demo123', fullName: 'Engr. Carlos Mendoza', role: 'engineer_1' },
    { email: 'constructflow.engineer1.3@gmail.com', password: 'demo123', fullName: 'Engr. Sofia Ramirez', role: 'engineer_1' },
    { email: 'constructflow.engineer2.1@gmail.com', password: 'demo123', fullName: 'Engr. Maria Santos', role: 'engineer_2' },
    { email: 'constructflow.engineer2.2@gmail.com', password: 'demo123', fullName: 'Engr. Luis Garcia', role: 'engineer_2' },
    { email: 'constructflow.engineer2.3@gmail.com', password: 'demo123', fullName: 'Engr. Elena Cruz', role: 'engineer_2' },
    { email: 'constructflow.engineer3.1@gmail.com', password: 'demo123', fullName: 'Engr. Pedro Reyes', role: 'engineer_3' },
    { email: 'constructflow.engineer4.1@gmail.com', password: 'demo123', fullName: 'Engr. Ana Lopez', role: 'engineer_4' },
    { email: 'constructflow.contractor.1@gmail.com', password: 'demo123', fullName: 'ABC Construction Corp.', role: 'contractor' },
    { email: 'constructflow.contractor.2@gmail.com', password: 'demo123', fullName: 'TS Construction', role: 'contractor' },
    { email: 'constructflow.contractor.3@gmail.com', password: 'demo123', fullName: 'North Builders Inc.', role: 'contractor' },
];
exports.seedDemoData = (0, https_1.onCall)({ invoker: 'public' }, async () => {
    const contractorUids = [];
    for (const account of DEMO_USERS) {
        let uid;
        try {
            const created = await admin.auth().createUser({
                email: account.email,
                password: account.password,
                displayName: account.fullName,
            });
            uid = created.uid;
        }
        catch (err) {
            const code = err?.code;
            if (code !== 'auth/email-already-exists')
                throw err;
            const existing = await admin.auth().getUserByEmail(account.email);
            uid = existing.uid;
        }
        await db.collection('users').doc(uid).set({
            email: account.email,
            fullName: account.fullName,
            role: account.role,
            isActive: true,
            createdAt: new Date().toISOString(),
        }, { merge: true });
        if (account.role === 'contractor')
            contractorUids.push(uid);
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
            contractorName: 'ABC Construction Corp.',
        },
        {
            id: 'demo-remebella-road',
            name: 'Remebella Road Improvement',
            location: 'Remebella, Buguey, Cagayan',
            status: 'active',
            startDate: '2025-07-01',
            plannedEndDate: '2025-10-19',
            contractAmount: 5991119.01,
            contractorId: contractorUids[1] ?? null,
            contractorName: 'TS Construction',
        },
        {
            id: 'demo-north-zone-pipe',
            name: 'North Zone Pipe Replacement',
            location: 'North Zone, Cagayan',
            status: 'active',
            startDate: '2025-08-01',
            plannedEndDate: '2025-12-15',
            contractAmount: 2500000,
            contractorId: contractorUids[2] ?? null,
            contractorName: 'North Builders Inc.',
        },
    ];
    for (const p of projects) {
        const { id, ...rest } = p;
        await db.collection('projects').doc(id).set({ ...rest, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
        await db.collection('schedules').doc(id).set({
            projectId: id,
            activities: [],
            dependencies: [],
            barChartTasks: [],
            barChartTotalDays: 1,
            barChartTimeNow: 0,
            projectDuration: 0,
            criticalPath: [],
            updatedAt: new Date().toISOString(),
        }, { merge: true });
    }
    return { ok: true, users: DEMO_USERS.length, projects: projects.length };
});
exports.finalizeReport = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in required');
    const reportId = String(request.data?.reportId ?? '');
    if (!reportId)
        throw new https_1.HttpsError('invalid-argument', 'reportId required');
    const ref = db.collection('reports').doc(reportId);
    const snap = await ref.get();
    if (!snap.exists)
        throw new https_1.HttpsError('not-found', 'Report not found');
    const data = snap.data();
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
    await ref.set({
        status: 'generated',
        pdfPath: pdfUrl,
        qrCode,
        generatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }, { merge: true });
    return { pdf_url: pdfUrl, qr_code: qrCode };
});
exports.sendWorkflowEmail = (0, https_1.onCall)(async (request) => {
    const reportId = String(request.data?.reportId ?? '');
    const event = String(request.data?.event ?? '');
    if (!reportId)
        throw new https_1.HttpsError('invalid-argument', 'reportId required');
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
    }
    catch (err) {
        await queueRef.update({
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
        });
        throw new https_1.HttpsError('internal', 'Email send failed');
    }
});
exports.onEmailQueueCreated = (0, firestore_1.onDocumentCreated)('emailQueue/{id}', async (event) => {
    const data = event.data?.data();
    if (!data || data.status !== 'queued')
        return;
    // Marker for extension / future SMTP worker
    await event.data?.ref.set({ seenByFunction: true }, { merge: true });
});
exports.verifyReport = (0, https_1.onCall)({ invoker: 'public' }, async (request) => {
    const qr = String(request.data?.qr ?? request.data?.reportNumber ?? '');
    if (!qr)
        throw new https_1.HttpsError('invalid-argument', 'qr required');
    let snap = await db.collection('reports').where('qrCode', '==', qr).limit(1).get();
    if (snap.empty) {
        snap = await db.collection('reports').where('reportNumber', '==', qr).limit(1).get();
    }
    if (snap.empty)
        return { valid: false, message: 'Invalid QR code' };
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
//# sourceMappingURL=index.js.map