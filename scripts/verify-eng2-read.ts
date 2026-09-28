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
  const projectId = 'Tg9Js8vQlI9nkaoKBIeI';

  await signInWithEmailAndPassword(auth, 'constructflow.engineer2.1@gmail.com', 'engineer123');
  console.log('uid', auth.currentUser?.uid);

  const projects = await getDocs(collection(db, 'projects'));
  console.log(
    'projects',
    projects.size,
    projects.docs.map((d) => ({ id: d.id, name: d.data().name, life: d.data().lifecycleState })),
  );

  const sched = await getDoc(doc(db, 'schedules', projectId));
  console.log('schedule', sched.exists(), 'activities', (sched.data()?.activities || []).length);

  const scurve = await getDoc(doc(db, 'sCurves', projectId));
  console.log('sCurve', scurve.exists());

  const pending = await getDocs(
    query(collection(db, 'reports'), where('status', '==', 'pending_review')),
  );
  console.log(
    'pending_review',
    pending.docs.map((d) => ({ id: d.id, type: d.data().reportType, projectId: d.data().projectId })),
  );

  await signOut(auth);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
