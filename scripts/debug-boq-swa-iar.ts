/**
 * Debug: Project BOQ → SWA/IAR Item No. data flow
 * Usage: npx tsx scripts/debug-boq-swa-iar.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
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

function mapLikeApp(data: Record<string, unknown>) {
  const firstString = (keys: string[]) => {
    for (const key of keys) {
      const value = data[key];
      if (value != null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };
  return {
    payItemId: firstString(['payItemId', 'pay_item_id', 'payItemID']),
    itemNo: firstString(['itemNo', 'item_no', 'ItemNo', 'number']),
    description: firstString(['description', 'Description', 'name']),
    unit: firstString(['unit', 'Unit']),
    active: data.active !== false,
    keys: Object.keys(data).sort(),
  };
}

async function listAccessibleProjectIds(
  db: ReturnType<typeof getFirestore>,
  uid: string,
  role: string,
): Promise<Array<{ id: string; name: string; life: string }>> {
  if (role === 'engineer_3' || role === 'engineer_4') {
    const snap = await getDocs(collection(db, 'projects'));
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        name: String(data.name ?? ''),
        life: String(data.lifecycleState ?? 'active'),
      };
    });
  }

  const userSnap = await getDoc(doc(db, 'users', uid));
  const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
  const ids = [
    ...(Array.isArray(userData.accessibleProjectIds) ? userData.accessibleProjectIds : []),
    ...(Array.isArray(userData.assignedProjectIds) ? userData.assignedProjectIds : []),
    ...(Array.isArray(userData.involvedProjectIds) ? userData.involvedProjectIds : []),
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  const unique = [...new Set(ids)];
  const out: Array<{ id: string; name: string; life: string }> = [];
  for (const id of unique) {
    try {
      const snap = await getDoc(doc(db, 'projects', id));
      if (!snap.exists()) continue;
      const data = snap.data() as Record<string, unknown>;
      out.push({
        id,
        name: String(data.name ?? ''),
        life: String(data.lifecycleState ?? 'active'),
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

async function runAs(email: string, password: string) {
  const app = initializeApp(firebaseConfig, `debug-${email}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  process.stdout.write(`\n=== ${email} ===\n`);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  const userSnap = await getDoc(doc(db, 'users', uid));
  const role = String(userSnap.data()?.role ?? '');
  process.stdout.write(`uid=${uid} role=${role}\n`);

  const projectDocs = await listAccessibleProjectIds(db, uid, role);
  const active = projectDocs.filter((p) => p.life !== 'archived');
  process.stdout.write(`projects accessible=${projectDocs.length} active=${active.length}\n`);

  let withBoq = 0;
  let emptyBoq = 0;
  let permissionFail = 0;
  const samples: unknown[] = [];

  for (const p of active.slice(0, 40)) {
    try {
      const boqSnap = await getDocs(collection(db, 'projects', p.id, 'boqItems'));
      if (boqSnap.empty) {
        emptyBoq += 1;
        continue;
      }
      withBoq += 1;
      const first = boqSnap.docs[0]!;
      const raw = first.data() as Record<string, unknown>;
      const mapped = mapLikeApp(raw);
      const selectable = boqSnap.docs
        .map((d) => mapLikeApp(d.data() as Record<string, unknown>))
        .filter((row) => row.active !== false && (row.payItemId || row.itemNo));
      samples.push({
        projectId: p.id,
        projectName: p.name,
        boqCount: boqSnap.size,
        selectableCount: selectable.length,
        firstRawKeys: mapped.keys,
        firstMapped: {
          payItemId: mapped.payItemId,
          itemNo: mapped.itemNo,
          description: mapped.description.slice(0, 50),
          unit: mapped.unit,
          active: mapped.active,
        },
        wouldShowInPayItemSelect: selectable.length > 0,
      });
    } catch (err) {
      permissionFail += 1;
      process.stdout.write(
        `  boq FAIL project=${p.id}: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  }

  process.stdout.write(
    `${JSON.stringify({ withBoq, emptyBoq, permissionFail, samples }, null, 2)}\n`,
  );
  await signOut(auth);
}

async function main() {
  await runAs('constructflow.engineer4.1@gmail.com', 'engineer123');
  await runAs('constructflow.engineer1.1@gmail.com', 'engineer123');
  await runAs('constructflow.contractor.1@gmail.com', 'contractor123');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
