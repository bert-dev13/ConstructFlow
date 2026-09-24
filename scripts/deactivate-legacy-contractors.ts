/**
 * Deactivate legacy contractor user docs that are not official ConstructFlow accounts.
 * Usage: npx tsx scripts/deactivate-legacy-contractors.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDocs, getFirestore, query, updateDoc, where } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain: 'constructflow-c82cd.firebaseapp.com',
  projectId: 'constructflow-c82cd',
  storageBucket: 'constructflow-c82cd.firebasestorage.app',
  messagingSenderId: '173177123241',
  appId: '1:173177123241:web:cb0aea82e4e8e9cf1cd4b8',
};

const LEGACY_CONTRACTOR_EMAILS = new Set([
  'contractor@gmail.com',
  'contractor@demo.com',
]);

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // Engineer IV may update any user doc.
  await signInWithEmailAndPassword(auth, 'constructflow.engineer4.1@gmail.com', 'engineer123');

  const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'contractor')));
  console.log(`Found ${snap.size} contractor role docs`);

  for (const d of snap.docs) {
    const data = d.data();
    const email = String(data.email ?? '').trim().toLowerCase();
    if (!email) {
      await updateDoc(doc(db, 'users', d.id), { isActive: false, updatedAt: new Date().toISOString() });
      console.log(`  deactivated (no email): ${d.id}`);
      continue;
    }
    if (LEGACY_CONTRACTOR_EMAILS.has(email)) {
      await updateDoc(doc(db, 'users', d.id), {
        isActive: false,
        updatedAt: new Date().toISOString(),
      });
      console.log(`  deactivated legacy: ${email} (${d.id})`);
      continue;
    }
    if (data.isActive === false) {
      console.log(`  already inactive: ${email}`);
      continue;
    }
    console.log(`  keep active: ${email}`);
  }

  const after = await getDocs(query(collection(db, 'users'), where('role', '==', 'contractor')));
  const visible = after.docs.filter((d) => {
    const data = d.data();
    if (data.isActive === false) return false;
    const email = String(data.email ?? '').trim();
    const name = String(data.fullName ?? data.name ?? '').trim();
    return Boolean(email && email.includes('@') && name);
  });
  console.log(`\nVisible contractors after fix: ${visible.length}`);
  for (const d of visible) {
    const data = d.data();
    console.log(`  - ${data.fullName} <${data.email}>`);
  }

  await signOut(auth);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
