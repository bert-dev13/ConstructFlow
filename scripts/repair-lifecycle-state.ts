/**
 * Set lifecycleState=active on projects missing it (breaks BOQ rules).
 * Usage: npx tsx scripts/repair-lifecycle-state.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, updateDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain: 'constructflow-c82cd.firebaseapp.com',
  projectId: 'constructflow-c82cd',
  storageBucket: 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId: '173177123241',
  appId: '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // Eng1.1 can update metadata on projects they can access.
  await signInWithEmailAndPassword(auth, 'constructflow.engineer1.1@gmail.com', 'engineer123');
  const uid = auth.currentUser!.uid;
  const user = (await getDoc(doc(db, 'users', uid))).data() as Record<string, unknown>;
  const ids = [
    ...((user.accessibleProjectIds as string[]) || []),
    ...((user.assignedProjectIds as string[]) || []),
  ];
  const unique = [...new Set(ids)];
  console.log(`Checking ${unique.length} projects as eng1.1`);

  let fixed = 0;
  let ok = 0;
  let failed = 0;

  for (const id of unique) {
    try {
      const ref = doc(db, 'projects', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const data = snap.data() as Record<string, unknown>;
      if (typeof data.lifecycleState === 'string' && data.lifecycleState) {
        ok += 1;
        continue;
      }
      await updateDoc(ref, {
        lifecycleState: 'active',
        updatedAt: new Date().toISOString(),
      });
      console.log(`  fixed ${id}`);
      fixed += 1;

      // verify boq
      try {
        const boq = await getDocs(collection(db, 'projects', id, 'boqItems'));
        console.log(`    boq OK (${boq.size})`);
      } catch (e) {
        console.log(`    boq still fail: ${e instanceof Error ? e.message : e}`);
      }
    } catch (e) {
      failed += 1;
      console.log(`  fail ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Also fix any remaining via eng4 global list + eng1 per-project if needed
  await signOut(auth);
  await signInWithEmailAndPassword(auth, 'constructflow.engineer4.1@gmail.com', 'engineer123');
  const all = await getDocs(collection(db, 'projects'));
  const missing = all.docs.filter((d) => typeof d.data().lifecycleState !== 'string');
  console.log(`\nEng4 sees ${all.size} projects, ${missing.length} still missing lifecycleState`);
  for (const d of missing) {
    console.log(`  still missing: ${d.id}`);
  }

  console.log(`\nDone. fixed=${fixed} alreadyOk=${ok} failed=${failed}`);
  await signOut(auth);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
