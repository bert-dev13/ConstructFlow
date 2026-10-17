/**
 * Load the DPWH Revised Standard Pay Item List (DO 143 s. 2017)
 * into Firestore payItems so Pay Item Master shows the full document.
 *
 * Source: src/data/boq/catalog.json (extracted from public/DO_143_s2017 (1).pdf).
 * Skips item numbers already in the master. Safe to re-run.
 *
 * Usage: npx tsx scripts/seed-dpwh-pay-items.ts
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDocs, getFirestore, writeBatch } from 'firebase/firestore';
import { normalizePayItemNo, payItemUniquenessKey } from '../src/lib/firebase/payItems';

type CatalogRow = {
  itemNo?: string;
  description?: string;
  unit?: string;
};

const firebaseConfig = {
  apiKey: 'AIzaSyCP8rGySmmAcy_i8UfQxnus5Cfc0wJVRN0',
  authDomain: 'constructflow-c82cd.firebaseapp.com',
  projectId: 'constructflow-c82cd',
};

function usableUnit(unit: string | undefined): string {
  const value = String(unit ?? '').trim();
  return value || '—';
}

async function main() {
  const rows = JSON.parse(
    readFileSync(new URL('../src/data/boq/catalog.json', import.meta.url), 'utf8'),
  ) as CatalogRow[];

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const cred = await signInWithEmailAndPassword(
    auth,
    'constructflow.engineer1.1@gmail.com',
    'engineer123',
  );

  const existing = await getDocs(collection(db, 'payItems'));
  const have = new Set(
    existing.docs.map((item) =>
      String(item.data().normalizedItemNo ?? normalizePayItemNo(String(item.data().itemNo ?? ''))),
    ),
  );

  const pending: CatalogRow[] = [];
  const seen = new Set<string>();
  let skippedEmpty = 0;
  let skippedExisting = 0;
  for (const row of rows) {
    const itemNo = String(row.itemNo ?? '').trim();
    const description = String(row.description ?? '').trim();
    if (!itemNo || !description) {
      skippedEmpty += 1;
      continue;
    }
    const key = normalizePayItemNo(itemNo);
    if (!key || seen.has(key) || have.has(key)) {
      skippedExisting += 1;
      continue;
    }
    seen.add(key);
    pending.push({ itemNo, description, unit: usableUnit(row.unit) });
  }

  const timestamp = new Date().toISOString();
  const actorId = cred.user.uid;
  let written = 0;
  for (let i = 0; i < pending.length; i += 400) {
    const batch = writeBatch(db);
    const slice = pending.slice(i, i + 400);
    for (const row of slice) {
      const itemNo = row.itemNo!.trim();
      const normalizedItemNo = normalizePayItemNo(itemNo);
      const version = 1;
      batch.set(doc(db, 'payItems', `dpwh_${normalizedItemNo}`), {
        itemNo,
        normalizedItemNo,
        description: row.description,
        unit: row.unit,
        active: true,
        version,
        uniquenessKey: payItemUniquenessKey(normalizedItemNo, version),
        source: 'DO 143 s. 2017',
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: actorId,
      });
    }
    await batch.commit();
    written += slice.length;
    console.log(`wrote ${written}/${pending.length}`);
  }

  console.log(
    JSON.stringify({
      catalogRows: rows.length,
      alreadyInMaster: skippedExisting,
      skippedEmpty,
      added: written,
      masterAfter: have.size + written,
    }),
  );
  await signOut(auth);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
