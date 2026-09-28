/**
 * Ensure Engineer II reviewers can access the live Cato-Conner project,
 * its schedule/S-Curve, and pending_review reports.
 *
 * Usage: npx tsx scripts/repair-eng2-project-access.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'constructflow-c82cd.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd',
};

const PROJECT_ID = 'Tg9Js8vQlI9nkaoKBIeI';

function unique(ids: string[]) {
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, 'constructflow.engineer4.1@gmail.com', 'engineer123');

  const eng2Snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'engineer_2')));
  const eng2Ids = eng2Snap.docs
    .filter((d) => String(d.data().email || '').includes('constructflow.engineer2'))
    .map((d) => d.id);
  console.log('constructflow Eng II ids', eng2Ids);

  const projectRef = doc(db, 'projects', PROJECT_ID);
  const projectSnap = await getDoc(projectRef);
  if (!projectSnap.exists()) {
    throw new Error(`Project ${PROJECT_ID} missing`);
  }
  const prev = projectSnap.data() as Record<string, unknown>;
  const assigned = unique([
    ...((prev.assignedUserIds as string[]) ?? []),
    String(prev.contractorId ?? ''),
  ]);
  const involved = unique([
    ...((prev.involvedUserIds as string[]) ?? []),
    ...eng2Ids,
  ]);
  const accessUserIds = unique([
    String(prev.contractorId ?? ''),
    ...assigned,
    ...involved,
  ]);

  await updateDoc(projectRef, {
    involvedUserIds: involved,
    accessUserIds,
    updatedAt: new Date().toISOString(),
  });
  console.log('project access updated', { involved, accessUserIds });

  for (const uid of eng2Ids) {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) continue;
    const data = userSnap.data() as Record<string, unknown>;
    const accessible = unique([
      ...((data.accessibleProjectIds as string[]) ?? []),
      PROJECT_ID,
    ]);
    const involvedProjects = unique([
      ...((data.involvedProjectIds as string[]) ?? []),
      PROJECT_ID,
    ]);
    await updateDoc(userRef, {
      accessibleProjectIds: accessible,
      involvedProjectIds: involvedProjects,
    });
    console.log('user pointers', uid, { accessible, involvedProjects });
  }

  const reports = await getDocs(
    query(collection(db, 'reports'), where('projectId', '==', PROJECT_ID)),
  );
  for (const report of reports.docs) {
    await updateDoc(report.ref, { accessUserIds });
    console.log('report access', report.id, report.data().status);
  }

  await signOut(auth);
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
