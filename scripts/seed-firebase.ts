/**
 * Seeds the official ConstructFlow Firebase account data.
 *
 * Usage: npx tsx scripts/seed-firebase.ts
 *
 * Strategy:
 * 1. Try the deployed admin-backed callable `seedDemoData`.
 * 2. If it is unavailable, fall back to direct client SDK writes.
 */
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import {
  collection,
  deleteField,
  doc,
  getDocs,
  getFirestore,
  runTransaction,
  setDoc,
} from 'firebase/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd';
const region = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || 'us-central1';
const seedUrl = `https://${region}-${projectId}.cloudfunctions.net/seedDemoData`;

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'constructflow-c82cd.firebaseapp.com',
  projectId,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '173177123241',
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

const ACCOUNTS = [
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
] as const;

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

const LEGACY_PASSWORDS = ['demo123', 'engineer123', 'contractor123'] as const;

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function buildProjectAccess(input: {
  contractorId?: string | null;
  assignedUserIds?: string[];
  involvedUserIds?: string[];
}) {
  const assignedUserIds = uniqueIds([
    ...(input.assignedUserIds ?? []),
    input.contractorId ?? null,
  ]);
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
      return { base: parts.slice(0, -1).join('-'), nextSuffix: suffix + 1 };
    }
  }
  return { base: reportNumber, nextSuffix: 2 };
}

async function tryCallableSeed() {
  const response = await fetch(seedUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: {} }),
  });

  if (!response.ok) {
    throw new Error(`Seed request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { message?: string };
  };
  if (payload.error) {
    throw new Error(payload.error.message || 'Seed function returned an error');
  }
  return payload.result ?? {};
}

async function signInWithKnownPassword(
  auth: ReturnType<typeof getAuth>,
  email: string,
  requiredPassword: string,
) {
  try {
    return await signInWithEmailAndPassword(auth, email, requiredPassword);
  } catch (primaryError) {
    for (const legacyPassword of LEGACY_PASSWORDS) {
      if (legacyPassword === requiredPassword) continue;
      try {
        const cred = await signInWithEmailAndPassword(auth, email, legacyPassword);
        await updatePassword(cred.user, requiredPassword);
        console.log(`Updated password for existing auth user ${email}`);
        return cred;
      } catch {
        /* try next known legacy password */
      }
    }
    throw primaryError;
  }
}

async function directSeed() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const now = new Date().toISOString();
  const usersByEmail = new Map<string, { uid: string; role: string; fullName: string }>();

  for (const account of ACCOUNTS) {
    let uid: string;
    try {
      const created = await createUserWithEmailAndPassword(auth, account.email, account.password);
      uid = created.user.uid;
      console.log('Created auth user', account.email);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== 'auth/email-already-in-use') throw err;
      try {
        const signedIn = await signInWithKnownPassword(auth, account.email, account.password);
        uid = signedIn.user.uid;
        console.log('Signed in existing auth user', account.email);
      } catch (signInError) {
        throw new Error(
          `Existing auth user ${account.email} could not be signed in with the required password.`,
          { cause: signInError },
        );
      }
    }

    usersByEmail.set(account.email, {
      uid,
      role: account.role,
      fullName: account.fullName,
    });
    await signOut(auth);
  }

  const allProjectIds = PROJECT_SPECS.map((project) => project.id);

  for (const account of ACCOUNTS) {
    const user = usersByEmail.get(account.email)!;
    await signInWithEmailAndPassword(auth, account.email, account.password);
    const assignedProjectIds = PROJECT_SPECS
      .filter((project) =>
        project.contractorEmail === account.email || project.engineer1Email === account.email,
      )
      .map((project) => project.id);
    const involvedProjectIds = PROJECT_SPECS
      .filter((project) => project.engineer2Emails.some((email) => email === account.email))
      .map((project) => project.id);
    const accessibleProjectIds =
      account.role === 'engineer_3' || account.role === 'engineer_4'
        ? allProjectIds
        : uniqueIds([...assignedProjectIds, ...involvedProjectIds]);

    await setDoc(
      doc(db, 'users', user.uid),
      {
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        isActive: true,
        isTestAccount: deleteField(),
        isDevelopmentAccount: deleteField(),
        accountType: deleteField(),
        notes: deleteField(),
        assignedProjectIds,
        involvedProjectIds,
        accessibleProjectIds,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    await signOut(auth);
  }

  await signInWithEmailAndPassword(auth, 'constructflow.engineer1.1@gmail.com', 'engineer123');

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
    await setDoc(
      doc(db, 'projects', project.id),
      {
        name: project.name,
        location: project.location,
        status: project.status,
        startDate: project.startDate,
        plannedEndDate: project.plannedEndDate,
        contractAmount: project.contractAmount,
        contractorId: access.contractorId,
        contractorName: contractor?.fullName ?? null,
        assignedUserIds: access.assignedUserIds,
        involvedUserIds: access.involvedUserIds,
        accessUserIds: access.accessUserIds,
        isTestProject: deleteField(),
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    await setDoc(
      doc(db, 'schedules', project.id),
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

  const projectsSnap = await getDocs(collection(db, 'projects'));
  const projectAccessById = new Map<string, { accessUserIds: string[] }>();
  for (const projectDoc of projectsSnap.docs) {
    const data = projectDoc.data() as Record<string, unknown>;
    const access = buildProjectAccess({
      contractorId: typeof data.contractorId === 'string' ? data.contractorId : null,
      assignedUserIds: Array.isArray(data.assignedUserIds)
        ? data.assignedUserIds.filter((value): value is string => typeof value === 'string')
        : [],
      involvedUserIds: Array.isArray(data.involvedUserIds)
        ? data.involvedUserIds.filter((value): value is string => typeof value === 'string')
        : [],
    });
    projectAccessById.set(projectDoc.id, { accessUserIds: access.accessUserIds });
    await setDoc(
      projectDoc.ref,
      {
        contractorId: access.contractorId,
        assignedUserIds: access.assignedUserIds,
        involvedUserIds: access.involvedUserIds,
        accessUserIds: access.accessUserIds,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  const reportsSnap = await getDocs(collection(db, 'reports'));
  const counterNextSuffix = new Map<string, number>();
  for (const reportDoc of reportsSnap.docs) {
    const data = reportDoc.data() as Record<string, unknown>;
    const projectAccess = projectAccessById.get(String(data.projectId ?? ''));
    const reportNumber = String(data.reportNumber ?? '');
    if (reportNumber) {
      const parsed = parseReportNumberCounter(reportNumber);
      const prev = counterNextSuffix.get(parsed.base) ?? 1;
      counterNextSuffix.set(parsed.base, Math.max(prev, parsed.nextSuffix));
    }
    if (!projectAccess) continue;
    await setDoc(
      reportDoc.ref,
      {
        accessUserIds: projectAccess.accessUserIds,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  for (const [base, nextSuffix] of counterNextSuffix.entries()) {
    await runTransaction(db, async (tx) => {
      tx.set(
        doc(db, 'counters', `reportNumber_${base}`),
        {
          kind: 'report_number',
          base,
          nextSuffix,
          updatedAt: now,
        },
        { merge: true },
      );
    });
  }

  await signOut(auth);
  return {
    ok: true,
    mode: 'direct-client',
    users: ACCOUNTS.length,
    projects: PROJECT_SPECS.length,
    reportsUpdated: reportsSnap.size,
    countersUpdated: counterNextSuffix.size,
  };
}

async function main() {
  try {
    const result = await tryCallableSeed();
    console.log('Seed complete via callable.');
    console.log(JSON.stringify(result, null, 2));
    return;
  } catch (callableError) {
    console.warn('Callable seed unavailable, falling back to direct client seeding.');
    console.warn(callableError instanceof Error ? callableError.message : String(callableError));
  }

  const result = await directSeed();

  console.log('Seed complete.');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
