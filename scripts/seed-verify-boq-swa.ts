/**
 * Ensure the live Cato-Conner project has at least one BOQ row, then print
 * the SWA/IAR selectable shape (same mapping as listProjectBoq / PayItemSelect).
 *
 * Usage: npx tsx scripts/seed-verify-boq-swa.ts
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'constructflow-c82cd.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd',
};

const PROJECT_ID = 'Tg9Js8vQlI9nkaoKBIeI';

function mapBoq(data: Record<string, unknown>) {
  const first = (keys: string[]) => {
    for (const key of keys) {
      const value = data[key];
      if (value != null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };
  return {
    payItemId: first(['payItemId', 'pay_item_id', 'payItemID']),
    itemNo: first(['itemNo', 'item_no', 'ItemNo', 'number']),
    description: first(['description', 'Description', 'name']),
    unit: first(['unit', 'Unit']),
    programmedQty: Number(data.programmedQty ?? data.programmed_qty ?? 0) || 0,
    unitPrice: Number(data.unitPrice ?? data.unit_price ?? 0) || 0,
    active: data.active !== false,
    keys: Object.keys(data).sort(),
  };
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // Eng IV can read any project; Eng I.2 owns Cato-Conner PDM historically.
  for (const email of [
    'constructflow.engineer4.1@gmail.com',
    'constructflow.engineer1.2@gmail.com',
    'constructflow.engineer1.1@gmail.com',
  ]) {
    await signInWithEmailAndPassword(auth, email, 'engineer123');
    const projectSnap = await getDoc(doc(db, 'projects', PROJECT_ID));
    console.log(`\n=== ${email} project exists=${projectSnap.exists()} ===`);
    if (!projectSnap.exists()) {
      await signOut(auth);
      continue;
    }
    const pdata = projectSnap.data() as Record<string, unknown>;
    console.log({
      name: pdata.name,
      life: pdata.lifecycleState,
      accessUserIds: pdata.accessUserIds,
    });

    let boqSnap = await getDocs(collection(db, 'projects', PROJECT_ID, 'boqItems'));
    console.log(`boqItems before: ${boqSnap.size}`);

    if (boqSnap.empty) {
      const masters = await getDocs(collection(db, 'payItems'));
      const activeMaster = masters.docs
        .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
        .find((row) => row.active !== false && (row.itemNo || row.item_no));
      if (!activeMaster) {
        console.log('No payItems master rows available to seed BOQ.');
        await signOut(auth);
        return;
      }
      const ref = doc(collection(db, 'projects', PROJECT_ID, 'boqItems'));
      const now = new Date().toISOString();
      const payload = {
        payItemId: activeMaster.id,
        payItemVersion: Number(activeMaster.version ?? 1) || 1,
        itemNo: String(activeMaster.itemNo ?? activeMaster.item_no ?? ''),
        description: String(activeMaster.description ?? ''),
        unit: String(activeMaster.unit ?? ''),
        programmedQty: 10,
        revisedQty: null,
        unitPrice: 100,
        weightPct: null,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await setDoc(ref, payload);
        console.log('Seeded BOQ row', { id: ref.id, itemNo: payload.itemNo });
      } catch (err) {
        console.log('Seed FAILED:', err instanceof Error ? err.message : err);
        await signOut(auth);
        continue;
      }
      boqSnap = await getDocs(collection(db, 'projects', PROJECT_ID, 'boqItems'));
    }

    const mapped = boqSnap.docs.map((d) => mapBoq(d.data() as Record<string, unknown>));
    const selectable = mapped.filter((row) => row.active !== false && (row.payItemId || row.itemNo));
    console.log(
      JSON.stringify(
        {
          projectId: PROJECT_ID,
          boqItemsLength: mapped.length,
          selectableLength: selectable.length,
          first: mapped[0] ?? null,
          swaOptionsLoaded: selectable.length > 0,
          iarOptionsLoaded: selectable.length > 0,
        },
        null,
        2,
      ),
    );
    await signOut(auth);
    return;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
