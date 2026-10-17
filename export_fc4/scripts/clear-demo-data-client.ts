/**
 * Clears seeded demo/sample Firestore records while keeping Auth accounts.
 *
 * Project parent docs cannot be hard-deleted under current security rules
 * (`allow delete: if false`), so they are archived (purgeAfter in the past).
 *
 * Usage: npx tsx scripts/clear-demo-data-client.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  DocumentReference,
  Firestore,
  getDocs,
  getFirestore,
  updateDoc,
  writeBatch,
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

const KNOWN_DEMO_PROJECT_IDS = [
  'demo-capitol-annex',
  'demo-remebella-road',
  'demo-north-zone-pipe',
] as const;

const ENGINEER_1_ACCOUNTS = [
  { email: 'constructflow.engineer1.1@gmail.com', password: 'engineer123' },
  { email: 'constructflow.engineer1.2@gmail.com', password: 'engineer123' },
  { email: 'constructflow.engineer1.3@gmail.com', password: 'engineer123' },
] as const;

function isDemoOrSampleProjectId(projectId: string) {
  return projectId.startsWith('demo-') || projectId.startsWith('sample-');
}

function nowIso() {
  return new Date().toISOString();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

async function deleteRefs(db: Firestore, refs: DocumentReference[], label: string) {
  let deleted = 0;
  for (let i = 0; i < refs.length; i += 400) {
    const chunk = refs.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const ref of chunk) batch.delete(ref);
    await batch.commit();
    deleted += chunk.length;
  }
  console.log(`  ${label}: ${deleted}`);
  return deleted;
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('Signing in as Engineer IV…');
  await signInWithEmailAndPassword(
    auth,
    'constructflow.engineer4.1@gmail.com',
    'engineer123',
  );

  const projectSnap = await getDocs(collection(db, 'projects'));
  const demoProjectIds = new Set<string>(KNOWN_DEMO_PROJECT_IDS);
  for (const projectDoc of projectSnap.docs) {
    if (isDemoOrSampleProjectId(projectDoc.id)) demoProjectIds.add(projectDoc.id);
  }
  console.log(`Demo/sample project ids: ${[...demoProjectIds].join(', ') || '(none)'}`);

  console.log('Deleting demo/sample reports…');
  const reportSnap = await getDocs(collection(db, 'reports'));
  const reportRefs: DocumentReference[] = [];
  for (const reportDoc of reportSnap.docs) {
    const data = reportDoc.data();
    const projectId = String(data.projectId ?? '');
    const reportNumber = String(data.reportNumber ?? '');
    const projectName = String(data.projectName ?? '');
    const isDemoReport =
      demoProjectIds.has(projectId)
      || isDemoOrSampleProjectId(projectId)
      || reportDoc.id.startsWith('sample-')
      || reportDoc.id.startsWith('demo-')
      || /sample/i.test(reportNumber)
      || /sample/i.test(projectName);
    if (isDemoReport) reportRefs.push(reportDoc.ref);
  }
  await deleteRefs(db, reportRefs, 'reports deleted');

  console.log('Deleting demo email queue entries…');
  const emailSnap = await getDocs(collection(db, 'emailQueue'));
  const emailRefs: DocumentReference[] = [];
  for (const emailDoc of emailSnap.docs) {
    const data = emailDoc.data();
    const projectId = String(data.projectId ?? '');
    const reportId = String(data.reportId ?? '');
    if (
      demoProjectIds.has(projectId)
      || isDemoOrSampleProjectId(projectId)
      || reportId.startsWith('sample-')
      || reportId.startsWith('demo-')
    ) {
      emailRefs.push(emailDoc.ref);
    }
  }
  await deleteRefs(db, emailRefs, 'emailQueue deleted');

  console.log('Deleting demo counters…');
  const counterSnap = await getDocs(collection(db, 'counters'));
  const counterRefs: DocumentReference[] = [];
  for (const counterDoc of counterSnap.docs) {
    const base = String(counterDoc.data().base ?? counterDoc.id);
    if (/sample/i.test(base) || /demo-/i.test(base) || counterDoc.id.includes('sample')) {
      counterRefs.push(counterDoc.ref);
    }
  }
  await deleteRefs(db, counterRefs, 'counters deleted');

  console.log('Deleting BOQ items under demo projects…');
  let boqDeleted = 0;
  for (const projectId of demoProjectIds) {
    try {
      const boqSnap = await getDocs(collection(db, 'projects', projectId, 'boqItems'));
      for (const boqDoc of boqSnap.docs) {
        await deleteDoc(boqDoc.ref);
        boqDeleted += 1;
      }
    } catch (err) {
      console.log(`  boq skip ${projectId}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`  boqItems deleted: ${boqDeleted}`);

  console.log('Archiving demo/sample projects…');
  let projectsArchived = 0;
  for (const projectDoc of projectSnap.docs) {
    if (!demoProjectIds.has(projectDoc.id)) continue;
    const data = projectDoc.data();
    if (String(data.lifecycleState ?? 'active') === 'archived') {
      console.log(`  already archived: ${projectDoc.id}`);
      continue;
    }
    try {
      await updateDoc(doc(db, 'projects', projectDoc.id), {
        lifecycleState: 'archived',
        archiveOwnerId: auth.currentUser!.uid,
        archiveOwnerRole: 'engineer_4',
        archivedAt: nowIso(),
        purgeAfter: new Date(Date.now() - 60_000).toISOString(),
        restoredAt: null,
        restoredBy: null,
        archivedAccessSnapshot: {
          contractorId: data.contractorId ?? null,
          assignedUserIds: stringArray(data.assignedUserIds),
          involvedUserIds: stringArray(data.involvedUserIds),
          accessUserIds: stringArray(data.accessUserIds),
        },
        contractorId: null,
        assignedUserIds: [auth.currentUser!.uid],
        involvedUserIds: [],
        accessUserIds: [auth.currentUser!.uid],
        updatedAt: nowIso(),
      });
      projectsArchived += 1;
      console.log(`  archived: ${projectDoc.id}`);
    } catch (err) {
      console.log(
        `  failed archive ${projectDoc.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  console.log(`Projects archived: ${projectsArchived}`);

  console.log('Clearing demo ids from user project pointers…');
  const usersSnap = await getDocs(collection(db, 'users'));
  let usersUpdated = 0;
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const strip = (value: unknown) =>
      stringArray(value).filter((id) => !demoProjectIds.has(id) && !isDemoOrSampleProjectId(id));
    const assignedProjectIds = strip(data.assignedProjectIds);
    const involvedProjectIds = strip(data.involvedProjectIds);
    const accessibleProjectIds = strip(data.accessibleProjectIds);
    const changed =
      JSON.stringify(assignedProjectIds) !== JSON.stringify(stringArray(data.assignedProjectIds))
      || JSON.stringify(involvedProjectIds) !== JSON.stringify(stringArray(data.involvedProjectIds))
      || JSON.stringify(accessibleProjectIds) !== JSON.stringify(stringArray(data.accessibleProjectIds));
    if (!changed) continue;
    await updateDoc(userDoc.ref, {
      assignedProjectIds,
      involvedProjectIds,
      accessibleProjectIds,
      updatedAt: nowIso(),
    });
    usersUpdated += 1;
  }
  console.log(`User project pointers updated: ${usersUpdated}`);

  await signOut(auth);

  console.log('Clearing schedules / S-curves via Engineer I accounts…');
  const remainingScheduleIds = new Set(demoProjectIds);
  const remainingSCurveIds = new Set(demoProjectIds);
  for (const account of ENGINEER_1_ACCOUNTS) {
    if (remainingScheduleIds.size === 0 && remainingSCurveIds.size === 0) break;
    await signInWithEmailAndPassword(auth, account.email, account.password);
    for (const projectId of [...remainingScheduleIds]) {
      try {
        await deleteDoc(doc(db, 'schedules', projectId));
        remainingScheduleIds.delete(projectId);
        console.log(`  schedule deleted (${account.email}): ${projectId}`);
      } catch {
        /* try next engineer */
      }
    }
    for (const projectId of [...remainingSCurveIds]) {
      try {
        const snaps = await getDocs(collection(db, 'sCurves', projectId, 'snapshots'));
        for (const snapDoc of snaps.docs) await deleteDoc(snapDoc.ref);
        await deleteDoc(doc(db, 'sCurves', projectId));
        remainingSCurveIds.delete(projectId);
        console.log(`  sCurve deleted (${account.email}): ${projectId}`);
      } catch {
        /* try next engineer */
      }
    }
    await signOut(auth);
  }
  if (remainingScheduleIds.size) {
    console.log(`  schedules remaining (no eng1 access): ${[...remainingScheduleIds].join(', ')}`);
  }
  if (remainingSCurveIds.size) {
    console.log(`  sCurves remaining (no eng1 access): ${[...remainingSCurveIds].join(', ')}`);
  }

  console.log('Done. Auth accounts preserved. Demo/sample operational data cleared.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
