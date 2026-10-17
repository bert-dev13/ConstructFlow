/**
 * E2E: create Pay Item → list/search finds it; contractor schedule save → reload.
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
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { writeFileSync } from 'fs';
import { applyPdmDerivatives } from '../src/lib/scheduleSync';
import { omitUndefinedDeep } from '../src/lib/firebase/ids';
import { normalizePayItemNo, payItemUniquenessKey } from '../src/lib/firebase/payItems';

const firebaseConfig = {
  apiKey: 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain: 'constructflow-c82cd.firebaseapp.com',
  projectId: 'constructflow-c82cd',
  storageBucket: 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId: '173177123241',
  appId: '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

const log: string[] = [];
function p(s: string) {
  log.push(s);
  console.log(s);
}

/** Same matching used by PayItemSelect. */
function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function matchesPayItemSelect(itemNo: string, description: string, unit: string, queryText: string) {
  const text = queryText.trim().toLowerCase();
  const key = normalizeQuery(queryText);
  if (!text) return true;
  const itemKey = normalizeQuery(itemNo);
  return (
    itemKey.includes(key)
    || itemNo.toLowerCase().includes(text)
    || description.toLowerCase().includes(text)
    || unit.toLowerCase().includes(text)
  );
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // --- Pay Item create + search ---
  await signInWithEmailAndPassword(auth, 'constructflow.engineer1.1@gmail.com', 'engineer123');
  const engUid = auth.currentUser!.uid;
  const itemNo = `E2E-${Date.now()}`;
  const normalizedItemNo = normalizePayItemNo(itemNo);
  const uniquenessKey = payItemUniquenessKey(normalizedItemNo, 1);
  const payRef = doc(collection(db, 'payItems'));
  const now = new Date().toISOString();
  await setDoc(payRef, {
    itemNo,
    normalizedItemNo,
    description: 'E2E verification pay item',
    unit: 'cu.m.',
    active: true,
    version: 1,
    uniquenessKey,
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    createdBy: engUid,
  });
  p(`payItem created id=${payRef.id} itemNo=${itemNo}`);

  const activeSnap = await getDocs(query(collection(db, 'payItems'), where('active', '==', true)));
  const foundActive = activeSnap.docs.some((d) => d.id === payRef.id);
  const selectable = activeSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        itemNo: String(data.itemNo ?? ''),
        description: String(data.description ?? ''),
        unit: String(data.unit ?? ''),
      };
    })
    .filter((item) => matchesPayItemSelect(item.itemNo, item.description, item.unit, itemNo));
  p(`search active foundById=${foundActive} selectorHits=${selectable.length}`);

  await updateDoc(payRef, { active: false, updatedAt: new Date().toISOString(), deletedAt: new Date().toISOString() });
  p('payItem soft-deleted (inactive)');
  await signOut(auth);

  // --- Contractor schedule save + reload ---
  await signInWithEmailAndPassword(auth, 'constructflow.contractor.1@gmail.com', 'contractor123');
  const contractorUid = auth.currentUser!.uid;
  const projects = await getDocs(
    query(collection(db, 'projects'), where('contractorId', '==', contractorUid)),
  );
  if (projects.empty) throw new Error('No contractor project');
  const projectId = projects.docs[0]!.id;
  const scheduleRef = doc(db, 'schedules', projectId);
  const before = (await getDoc(scheduleRef)).data() ?? null;
  const marker = `sched-e2e-${Date.now()}`;
  const derived = applyPdmDerivatives({
    project_id: projectId,
    activities: [
      { id: 'e2e-a1', number: 'A', name: marker, duration: 5 },
      { id: 'e2e-a2', number: 'B', name: `${marker}-b`, duration: 3 },
    ],
    dependencies: [
      { id: 'e2e-d1', fromId: 'e2e-a1', toId: 'e2e-a2', type: 'FS' as const, lag: 0 },
    ],
    barChartTasks: [],
    barChartTotalDays: 1,
    barChartTimeNow: 0,
    projectDuration: 0,
    criticalPath: [],
  });
  const payload = omitUndefinedDeep({
    ...derived,
    projectId,
    updatedAt: new Date().toISOString(),
  });
  await setDoc(scheduleRef, payload, { merge: true });
  const after = (await getDoc(scheduleRef)).data()!;
  const names = ((after.activities as { name?: string }[]) ?? []).map((a) => a.name);
  p(
    `schedule SAVE_OK project=${projectId} reloadHasMarker=${names.includes(marker)} actualEndDay=${JSON.stringify((after.barChartTasks as { actualEndDay?: unknown }[])?.[0]?.actualEndDay)}`,
  );
  if (before) await setDoc(scheduleRef, before);
  else
    await setDoc(scheduleRef, {
      projectId,
      activities: [],
      dependencies: [],
      barChartTasks: [],
      barChartTotalDays: 1,
      barChartTimeNow: 0,
      projectDuration: 0,
      criticalPath: [],
      updatedAt: new Date().toISOString(),
    });
  p('schedule restored');
  await signOut(auth);

  const ok = foundActive && selectable.length > 0 && names.includes(marker);
  p(ok ? 'E2E_OK' : 'E2E_FAIL');
  writeFileSync('scripts/e2e-verify-out.txt', log.join('\n'));
  if (!ok) process.exit(1);
}

main().catch((err) => {
  p(String(err));
  writeFileSync('scripts/e2e-verify-out.txt', log.join('\n'));
  process.exit(1);
});
