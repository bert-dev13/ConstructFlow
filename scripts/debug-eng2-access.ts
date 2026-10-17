import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, query, where } from 'firebase/firestore';

async function main() {
  const app = initializeApp({
    apiKey: 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
    authDomain: 'constructflow-c82cd.firebaseapp.com',
    projectId: 'constructflow-c82cd',
  });
  const auth = getAuth(app);
  const db = getFirestore(app);

  await signInWithEmailAndPassword(auth, 'constructflow.engineer4.1@gmail.com', 'engineer123');
  const projectId = 'Tg9Js8vQlI9nkaoKBIeI';
  const p = await getDoc(doc(db, 'projects', projectId));
  console.log(
    'project',
    JSON.stringify(
      {
        accessUserIds: p.data()?.accessUserIds,
        assignedUserIds: p.data()?.assignedUserIds,
        involvedUserIds: p.data()?.involvedUserIds,
        contractorId: p.data()?.contractorId,
        life: p.data()?.lifecycleState,
      },
      null,
      2,
    ),
  );

  const eng2 = await getDocs(query(collection(db, 'users'), where('role', '==', 'engineer_2')));
  console.log(
    'eng2 users',
    JSON.stringify(
      eng2.docs.map((d) => ({
        id: d.id,
        email: d.data().email,
        accessible: d.data().accessibleProjectIds,
        involved: d.data().involvedProjectIds,
      })),
      null,
      2,
    ),
  );

  const reports = await getDocs(query(collection(db, 'reports'), where('projectId', '==', projectId)));
  console.log(
    'reports',
    JSON.stringify(
      reports.docs.map((d) => ({
        id: d.id,
        type: d.data().reportType,
        status: d.data().status,
        access: d.data().accessUserIds,
      })),
      null,
      2,
    ),
  );

  const allPending = await getDocs(
    query(collection(db, 'reports'), where('status', '==', 'pending_review')),
  );
  console.log(
    'all pending_review',
    JSON.stringify(
      allPending.docs.map((d) => ({
        id: d.id,
        type: d.data().reportType,
        projectId: d.data().projectId,
        access: d.data().accessUserIds,
      })),
      null,
      2,
    ),
  );

  const sched = await getDoc(doc(db, 'schedules', projectId));
  console.log(
    'schedule',
    JSON.stringify({
      exists: sched.exists(),
      activities: sched.exists() ? (sched.data()?.activities || []).length : 0,
    }),
  );

  const scurve = await getDoc(doc(db, 'sCurves', projectId));
  console.log('sCurve exists', scurve.exists());

  await signOut(auth);

  if (eng2.docs[0]) {
    await signInWithEmailAndPassword(auth, String(eng2.docs[0].data().email), 'engineer123');
    const uid = auth.currentUser!.uid;
    console.log('\n=== as eng2', eng2.docs[0].data().email, uid, '===');
    try {
      const mine = await getDocs(
        query(collection(db, 'projects'), where('accessUserIds', 'array-contains', uid)),
      );
      console.log('projects via accessUserIds', mine.size, mine.docs.map((d) => d.id));
    } catch (e) {
      console.log('project query fail', e instanceof Error ? e.message : e);
    }
    try {
      const sched2 = await getDoc(doc(db, 'schedules', projectId));
      console.log('schedule read', sched2.exists());
    } catch (e) {
      console.log('schedule fail', e instanceof Error ? e.message : e);
    }
    try {
      const reps = await getDocs(
        query(collection(db, 'reports'), where('accessUserIds', 'array-contains', uid)),
      );
      console.log(
        'reports via accessUserIds',
        reps.size,
        reps.docs.map((d) => ({ id: d.id, status: d.data().status })),
      );
    } catch (e) {
      console.log('reports fail', e instanceof Error ? e.message : e);
    }
    await signOut(auth);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
