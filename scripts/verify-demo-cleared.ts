/**
 * Quick status of demo/sample leftovers and accounts.
 * Usage: npx tsx scripts/verify-demo-cleared.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, getDocs, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain: 'constructflow-c82cd.firebaseapp.com',
  projectId: 'constructflow-c82cd',
  storageBucket: 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId: '173177123241',
  appId: '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

const ACCOUNT_EMAILS = [
  'constructflow.contractor.1@gmail.com',
  'constructflow.contractor.2@gmail.com',
  'constructflow.contractor.3@gmail.com',
  'constructflow.engineer1.1@gmail.com',
  'constructflow.engineer1.2@gmail.com',
  'constructflow.engineer1.3@gmail.com',
  'constructflow.engineer2.1@gmail.com',
  'constructflow.engineer2.2@gmail.com',
  'constructflow.engineer2.3@gmail.com',
  'constructflow.engineer3.1@gmail.com',
  'constructflow.engineer4.1@gmail.com',
];

function isDemo(id: string) {
  return id.startsWith('demo-') || id.startsWith('sample-');
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, 'constructflow.engineer4.1@gmail.com', 'engineer123');

  const users = await getDocs(collection(db, 'users'));
  const kept = users.docs.filter((d) => ACCOUNT_EMAILS.includes(String(d.data().email ?? '')));
  console.log(`Accounts present: ${kept.length}/${ACCOUNT_EMAILS.length}`);
  for (const d of kept) {
    const data = d.data();
    console.log(
      `  ${data.email} role=${data.role} assigned=${(data.assignedProjectIds || []).length} accessible=${(data.accessibleProjectIds || []).length}`,
    );
  }

  const projects = await getDocs(collection(db, 'projects'));
  const demoProjects = projects.docs.filter((d) => isDemo(d.id));
  const activeDemo = demoProjects.filter((d) => String(d.data().lifecycleState ?? 'active') !== 'archived');
  console.log(`Demo/sample projects remaining: ${demoProjects.length} (active: ${activeDemo.length}, archived: ${demoProjects.length - activeDemo.length})`);
  for (const d of demoProjects.slice(0, 5)) {
    console.log(`  ${d.id} lifecycle=${d.data().lifecycleState}`);
  }
  if (demoProjects.length > 5) console.log(`  … +${demoProjects.length - 5} more`);

  const reports = await getDocs(collection(db, 'reports'));
  const demoReports = reports.docs.filter((d) => {
    const data = d.data();
    return isDemo(d.id) || isDemo(String(data.projectId ?? '')) || /sample/i.test(String(data.reportNumber ?? ''));
  });
  console.log(`Demo/sample reports remaining: ${demoReports.length}`);
  console.log(`Total projects: ${projects.size}, total reports: ${reports.size}`);

  await signOut(auth);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
