/**
 * Removes SAMPLE labels from seeded projects/reports and recreates report docs
 * with operational report numbers.
 *
 * Usage: npx tsx scripts/sanitize-sample-labels.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  updateDoc,
} from 'firebase/firestore';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function stripSampleLabel(value: string): string {
  return value
    .replace(/^SAMPLE\s*[-–—:]\s*/i, '')
    .replace(/\bSAMPLE\b\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function runMigrate(): Promise<void> {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(root, 'migrate-sample-projects.ts');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', script], {
      cwd: path.join(root, '..'),
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`migrate-sample-projects exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('Signing in as Engineer IV to remove SAMPLE-labeled report docs…');
  await signInWithEmailAndPassword(
    auth,
    'constructflow.engineer4.1@gmail.com',
    'engineer123',
  );

  const reportSnap = await getDocs(collection(db, 'reports'));
  let deletedReports = 0;
  for (const reportDoc of reportSnap.docs) {
    const data = reportDoc.data() as Record<string, unknown>;
    const number = String(data.reportNumber ?? '');
    const projectName = String(data.projectName ?? '');
    const isSample =
      reportDoc.id.startsWith('sample-')
      || /sample/i.test(number)
      || /sample/i.test(projectName)
      || String(data.projectId ?? '').startsWith('sample-');
    if (!isSample) continue;
    await deleteDoc(reportDoc.ref);
    deletedReports += 1;
    console.log(`  deleted report ${reportDoc.id}`);
  }
  console.log(`Deleted ${deletedReports} sample/report docs.`);

  console.log('Collecting SAMPLE project titles as Engineer IV…');
  const projectSnap = await getDocs(collection(db, 'projects'));
  const renames: Array<{ id: string; from: string; to: string }> = [];
  for (const projectDoc of projectSnap.docs) {
    const data = projectDoc.data() as Record<string, unknown>;
    const name = String(data.name ?? '');
    const nextName = stripSampleLabel(name);
    if (!nextName || nextName === name) continue;
    if (String(data.lifecycleState ?? 'active') !== 'active') {
      console.log(`  skip rename ${projectDoc.id} (lifecycle ${String(data.lifecycleState)})`);
      continue;
    }
    renames.push({ id: projectDoc.id, from: name, to: nextName });
  }

  await signOut(auth);
  console.log('Signing in as Engineer I to rename SAMPLE project titles…');
  await signInWithEmailAndPassword(
    auth,
    'constructflow.engineer1.1@gmail.com',
    'engineer123',
  );

  let renamedProjects = 0;
  for (const item of renames) {
    try {
      await updateDoc(doc(db, 'projects', item.id), { name: item.to });
      renamedProjects += 1;
      console.log(`  renamed ${item.id}: "${item.from}" -> "${item.to}"`);
    } catch (err) {
      console.log(
        `  failed rename ${item.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  console.log(`Renamed ${renamedProjects} projects.`);

  await signOut(auth);
  console.log('Re-seeding reports with operational labels…');
  await runMigrate();
  console.log('Done.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
