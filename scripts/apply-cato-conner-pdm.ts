/**
 * Apply the revised Cato-Conner reference PDM to demo-remebella-road in Firestore.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getFirestore, setDoc } from 'firebase/firestore';
import { buildRoadPdmSample, REFERENCE_PDM_TITLE } from '../src/data/roadPdmSample';
import { applyPdmDerivatives } from '../src/lib/scheduleSync';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'constructflow-c82cd.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '173177123241',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

const PROJECT_ID = 'demo-remebella-road';

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, 'constructflow.engineer1.2@gmail.com', 'engineer123');

  const sample = buildRoadPdmSample();
  const derived = applyPdmDerivatives({
    project_id: PROJECT_ID,
    activities: sample.activities,
    dependencies: sample.dependencies,
    barChartTasks: [],
    barChartTotalDays: 1,
    barChartTimeNow: 0,
    projectDuration: 0,
    criticalPath: [],
  });

  const now = new Date().toISOString();
  await setDoc(
    doc(db, 'projects', PROJECT_ID),
    {
      name: REFERENCE_PDM_TITLE,
      location: 'Cato-Conner Road, Tuao, Cagayan',
      updatedAt: now,
    },
    { merge: true },
  );
  await setDoc(
    doc(db, 'schedules', PROJECT_ID),
    {
      ...derived,
      projectId: PROJECT_ID,
      updatedAt: now,
    },
    { merge: true },
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId: PROJECT_ID,
        title: REFERENCE_PDM_TITLE,
        projectDuration: derived.projectDuration,
        criticalPath: derived.criticalPath,
        activities: derived.activities.map((a) => ({
          number: a.number,
          name: a.name,
          es: a.es,
          ef: a.ef,
          ls: a.ls,
          lf: a.lf,
          isCritical: a.isCritical,
        })),
        dependencies: derived.dependencies.map((d) => `${d.fromId}→${d.toId}`),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
