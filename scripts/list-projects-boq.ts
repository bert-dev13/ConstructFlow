/**
 * List every project + boqItems count (Eng IV).
 * Usage: npx tsx scripts/list-projects-boq.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'constructflow-c82cd.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd',
};

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, 'constructflow.engineer4.1@gmail.com', 'engineer123');

  const all = await getDocs(collection(db, 'projects'));
  const rows = [];
  for (const d of all.docs) {
    const data = d.data() as Record<string, unknown>;
    let boq = -1;
    let first: Record<string, unknown> | null = null;
    try {
      const boqSnap = await getDocs(collection(db, 'projects', d.id, 'boqItems'));
      boq = boqSnap.size;
      if (boqSnap.docs[0]) {
        const raw = boqSnap.docs[0].data() as Record<string, unknown>;
        first = {
          keys: Object.keys(raw).sort(),
          itemNo: raw.itemNo ?? raw.item_no ?? null,
          payItemId: raw.payItemId ?? raw.pay_item_id ?? null,
          active: raw.active,
        };
      }
    } catch (err) {
      boq = -2;
      first = { error: err instanceof Error ? err.message : String(err) };
    }
    rows.push({
      id: d.id,
      name: String(data.name ?? '').slice(0, 60),
      life: String(data.lifecycleState ?? '(missing)'),
      boq,
      first,
    });
  }
  rows.sort((a, b) => b.boq - a.boq);
  console.log(JSON.stringify(rows, null, 2));

  for (const id of ['sample-12-gattaran-road', 'demo-capitol-annex']) {
    const s = await getDoc(doc(db, 'projects', id));
    console.log(
      id,
      s.exists()
        ? JSON.stringify({ life: s.data()?.lifecycleState, name: s.data()?.name })
        : 'MISSING',
    );
  }
  await signOut(auth);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
