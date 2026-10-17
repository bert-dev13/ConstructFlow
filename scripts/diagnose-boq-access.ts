/**
 * Diagnose Project BOQ permission issues for demo Engineer accounts.
 * Usage: npx tsx scripts/diagnose-boq-access.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, query, where } from 'firebase/firestore';

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

const ACCOUNTS = [
  { email: 'constructflow.engineer1.1@gmail.com', password: 'engineer123' },
  { email: 'constructflow.engineer1.2@gmail.com', password: 'engineer123' },
  { email: 'constructflow.engineer1.3@gmail.com', password: 'engineer123' },
  { email: 'constructflow.engineer4.1@gmail.com', password: 'engineer123' },
] as const;

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  for (const account of ACCOUNTS) {
    console.log(`\n=== ${account.email} ===`);
    const cred = await signInWithEmailAndPassword(auth, account.email, account.password);
    const uid = cred.user.uid;
    const userSnap = await getDoc(doc(db, 'users', uid));
    const userData = userSnap.data() ?? {};
    console.log(`uid=${uid} role=${String(userData.role ?? 'MISSING')}`);

    let projects: Array<{ id: string; data: Record<string, unknown> }> = [];
    try {
      const snap = await getDocs(
        query(collection(db, 'projects'), where('accessUserIds', 'array-contains', uid)),
      );
      projects = snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
      console.log(`projects via accessUserIds: ${projects.length}`);
    } catch (err) {
      console.log(`project list failed: ${err instanceof Error ? err.message : err}`);
    }

    if (!projects.length && (userData.role === 'engineer_3' || userData.role === 'engineer_4')) {
      try {
        const snap = await getDocs(collection(db, 'projects'));
        projects = snap.docs.slice(0, 5).map((d) => ({
          id: d.id,
          data: d.data() as Record<string, unknown>,
        }));
        console.log(`projects via global list (sample): ${projects.length}`);
      } catch (err) {
        console.log(`global project list failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    const sample = projects.slice(0, 3);
    for (const project of sample) {
      const access = Array.isArray(project.data.accessUserIds) ? project.data.accessUserIds : [];
      const assigned = Array.isArray(project.data.assignedUserIds)
        ? project.data.assignedUserIds
        : [];
      const inAccess = access.includes(uid);
      const inAssigned = assigned.includes(uid);
      console.log(
        `  project ${project.id} lifecycle=${String(project.data.lifecycleState ?? 'active')} inAccess=${inAccess} inAssigned=${inAssigned}`,
      );
      try {
        const boqSnap = await getDocs(collection(db, 'projects', project.id, 'boqItems'));
        console.log(`    boqItems OK count=${boqSnap.size}`);
      } catch (err) {
        console.log(`    boqItems FAIL: ${err instanceof Error ? err.message : err}`);
      }
    }

    await signOut(auth);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
