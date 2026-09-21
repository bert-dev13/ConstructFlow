/**
 * Seed Firebase Auth + Firestore demo data.
 * Requires Email/Password auth enabled and Firestore open (or rules allowing writes while seeded).
 *
 * Usage: npx tsx scripts/seed-firebase.ts
 */
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, getFirestore, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'constructflow-c82cd.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd',
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '173177123241',
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

const DEMO_USERS = [
  { email: 'engineer1@gmail.com', password: 'engineer123', fullName: 'Engineer I', role: 'engineer_1' },
  { email: 'engineer2@gmail.com', password: 'engineer123', fullName: 'Engineer II', role: 'engineer_2' },
  { email: 'engineer3@gmail.com', password: 'engineer123', fullName: 'Engineer III', role: 'engineer_3' },
  { email: 'engineer4@gmail.com', password: 'engineer123', fullName: 'Engineer IV', role: 'engineer_4' },
  { email: 'contractor@gmail.com', password: 'engineer123', fullName: 'Contractor', role: 'contractor' },
] as const;

async function ensureUser(
  auth: ReturnType<typeof getAuth>,
  db: ReturnType<typeof getFirestore>,
  account: (typeof DEMO_USERS)[number],
) {
  let uid: string;
  try {
    const cred = await createUserWithEmailAndPassword(auth, account.email, account.password);
    uid = cred.user.uid;
    console.log('Created auth user', account.email);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== 'auth/email-already-in-use') throw err;
    const cred = await signInWithEmailAndPassword(auth, account.email, account.password);
    uid = cred.user.uid;
    console.log('Signed in existing', account.email);
  }
  await setDoc(
    doc(db, 'users', uid),
    {
      email: account.email,
      fullName: account.fullName,
      role: account.role,
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    { merge: true },
  );
  await signOut(auth);
  return uid;
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const contractorUids: string[] = [];
  for (const account of DEMO_USERS) {
    const uid = await ensureUser(auth, db, account);
    if (account.role === 'contractor') contractorUids.push(uid);
  }

  // Sign in as engineer_4 to write projects (rules allow engineer_1 create;
  // seed may need temporarily open rules — we sign in as engineer_1)
  await signInWithEmailAndPassword(auth, 'engineer1@gmail.com', 'engineer123');

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
    await setDoc(
      doc(db, 'projects', id),
      { ...rest, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { merge: true },
    );
    await setDoc(
      doc(db, 'schedules', id),
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
    console.log('Upserted project', id);
  }

  await signOut(auth);
  console.log('Seed complete. Password for all demo accounts: engineer123');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
