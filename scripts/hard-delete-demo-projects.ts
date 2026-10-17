/**
 * Hard-deletes archived demo/sample project trees (requires temporary rules).
 * Usage: npx tsx scripts/hard-delete-demo-projects.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
} from 'firebase/firestore';

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

function isDemoOrSampleProjectId(projectId: string) {
  return projectId.startsWith('demo-') || projectId.startsWith('sample-');
}

async function deleteCollectionDocs(
  db: ReturnType<typeof getFirestore>,
  pathSegments: string[],
) {
  const snap = await getDocs(collection(db, ...(pathSegments as [string, ...string[]])));
  for (const item of snap.docs) {
    await deleteDoc(item.ref);
  }
  return snap.size;
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  await signInWithEmailAndPassword(
    auth,
    'constructflow.engineer4.1@gmail.com',
    'engineer123',
  );

  const projectSnap = await getDocs(collection(db, 'projects'));
  const ids = projectSnap.docs.map((d) => d.id).filter(isDemoOrSampleProjectId);
  console.log(`Hard-deleting ${ids.length} demo/sample projects…`);

  for (const projectId of ids) {
    console.log(`  ${projectId}`);
    try {
      await deleteCollectionDocs(db, ['projects', projectId, 'boqItems']);
      await deleteCollectionDocs(db, ['projects', projectId, 'auditLog']);
      await deleteCollectionDocs(db, ['projects', projectId, 'contractHistory']);
      await deleteDoc(doc(db, 'projects', projectId));
      console.log('    project deleted');
    } catch (err) {
      console.log('    project FAIL:', err instanceof Error ? err.message : err);
    }

    try {
      await deleteDoc(doc(db, 'schedules', projectId));
      console.log('    schedule deleted');
    } catch (err) {
      console.log('    schedule skip:', err instanceof Error ? err.message : err);
    }

    try {
      await deleteCollectionDocs(db, ['sCurves', projectId, 'snapshots']);
      await deleteDoc(doc(db, 'sCurves', projectId));
      console.log('    sCurve deleted');
    } catch (err) {
      console.log('    sCurve skip:', err instanceof Error ? err.message : err);
    }
  }

  await signOut(auth);
  console.log('Hard delete complete.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
