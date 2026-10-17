/**
 * Live write using the same sanitization as saveScheduleFs against the reported project.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import { writeFileSync } from 'fs';
import { applyPdmDerivatives } from '../src/lib/scheduleSync';
import { omitUndefinedDeep } from '../src/lib/firebase/ids';
import type { BarChartTask, PdmActivity, PdmDependency } from '../src/types';

const PROJECT_ID = 'Tg9Js8vQlI9nkaoKBIeI';

const firebaseConfig = {
  apiKey: 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain: 'constructflow-c82cd.firebaseapp.com',
  projectId: 'constructflow-c82cd',
  storageBucket: 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId: '173177123241',
  appId: '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

function sanitizeActivityForFs(a: PdmActivity): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: String(a.id ?? ''),
    number: String(a.number ?? ''),
    name: String(a.name ?? ''),
    duration: Number.isFinite(Number(a.duration)) ? Number(a.duration) : 0,
  };
  if (a.payItemId) out.payItemId = String(a.payItemId);
  if (a.payItemVersion != null && Number.isFinite(Number(a.payItemVersion))) {
    out.payItemVersion = Number(a.payItemVersion);
  }
  if (a.unit != null && a.unit !== '') out.unit = String(a.unit);
  if (a.esOverride != null && Number.isFinite(Number(a.esOverride))) {
    out.esOverride = Number(a.esOverride);
  }
  if (a.extendToEnd === true) out.extendToEnd = true;
  if (a.extendToEnd === false) out.extendToEnd = false;
  if (a.es != null && Number.isFinite(Number(a.es))) out.es = Number(a.es);
  if (a.ef != null && Number.isFinite(Number(a.ef))) out.ef = Number(a.ef);
  if (a.ls != null && Number.isFinite(Number(a.ls))) out.ls = Number(a.ls);
  if (a.lf != null && Number.isFinite(Number(a.lf))) out.lf = Number(a.lf);
  if (a.isCritical === true || a.isCritical === false) out.isCritical = a.isCritical;
  return out;
}

function sanitizeDependencyForFs(d: PdmDependency): Record<string, unknown> {
  return {
    id: String(d.id ?? ''),
    fromId: String(d.fromId ?? ''),
    toId: String(d.toId ?? ''),
    type: d.type ?? 'FS',
    lag: Number.isFinite(Number(d.lag)) ? Number(d.lag) : 0,
  };
}

function sanitizeBarTaskForFs(t: BarChartTask): Record<string, unknown> {
  return {
    id: String(t.id ?? ''),
    index: Number(t.index) || 0,
    name: String(t.name ?? ''),
    startDay: Number(t.startDay) || 0,
    endDay: Number(t.endDay) || 0,
    actualEndDay: t.actualEndDay != null ? Number(t.actualEndDay) : null,
    isCritical: !!t.isCritical,
  };
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, 'constructflow.contractor.1@gmail.com', 'contractor123');

  const ref = doc(db, 'schedules', PROJECT_ID);
  const before = (await getDoc(ref)).data() ?? null;
  const marker = `sanitize-${Date.now()}`;

  const derived = applyPdmDerivatives({
    project_id: PROJECT_ID,
    activities: [
      {
        id: 's1',
        number: 'E2E-ITEM',
        name: marker,
        duration: 4,
        payItemId: 'fake-pay-item',
        payItemVersion: 1,
        unit: 'cu.m.',
        esOverride: undefined,
        extendToEnd: undefined,
      } as PdmActivity,
      { id: 's2', number: 'B', name: `${marker}-b`, duration: 2 },
    ],
    dependencies: [{ id: 'sd1', fromId: 's1', toId: 's2', type: 'FS' as const }],
    barChartTasks: [],
    barChartTotalDays: 1,
    barChartTimeNow: 0,
    projectDuration: 0,
    criticalPath: [],
  });

  const payload = omitUndefinedDeep({
    project_id: PROJECT_ID,
    projectId: PROJECT_ID,
    activities: derived.activities.map(sanitizeActivityForFs),
    dependencies: derived.dependencies.map(sanitizeDependencyForFs),
    barChartTasks: derived.barChartTasks.map(sanitizeBarTaskForFs),
    barChartTotalDays: Math.max(1, derived.barChartTotalDays),
    barChartTimeNow: derived.barChartTimeNow ?? 0,
    projectDuration: derived.projectDuration,
    criticalPath: derived.criticalPath,
    pdmError: derived.pdmError ?? null,
    updatedAt: new Date().toISOString(),
  });

  await setDoc(ref, payload, { merge: true });
  const after = (await getDoc(ref)).data()!;
  const names = ((after.activities as { name?: string; payItemId?: string }[]) ?? []).map(
    (a) => `${a.name}|${a.payItemId ?? ''}`,
  );
  const ok = names.some((n) => n.startsWith(marker));

  if (before) await setDoc(ref, before);
  await signOut(auth);

  const line = ok
    ? `SAVE_OK project=${PROJECT_ID} payItemKept=${names.some((n) => n.includes('fake-pay-item'))}`
    : 'SAVE_FAIL';
  console.log(line);
  writeFileSync('scripts/e2e-verify-out.txt', line);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
