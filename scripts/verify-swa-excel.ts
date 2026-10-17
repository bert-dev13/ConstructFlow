/**
 * Compare SWA computeWorkItems against Excel SWA (July 6-9) sample rows.
 */
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import {
  computeWorkItems,
  swaThisPeriodAmount,
  swaToDateAmount,
  type WorkItem,
} from '../src/lib/workItems';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');

const wb = XLSX.readFile('public/SWA-STEWA-RCBC.xlsx');
const sheet = wb.Sheets['SWA (July 6-9)']!;

function cell(addr: string) {
  return sheet[addr] as { f?: string; v?: unknown; w?: string } | undefined;
}

const sampleRows = [12, 13, 15, 18] as const;
const items: WorkItem[] = [];
const excelExpect: Array<{
  row: number;
  toDate: number;
  thisPeriod: number;
  wtAccomp: number;
  remarks: string;
}> = [];

const totalContract = Number(cell('G34')?.v ?? 0);

for (const r of sampleRows) {
  const qty = Number(cell(`D${r}`)?.v ?? 0);
  const price = Number(cell(`F${r}`)?.v ?? 0);
  const prev = Number(cell(`I${r}`)?.v ?? 0) || 0;
  items.push({
    id: `r${r}`,
    itemNo: String(cell(`A${r}`)?.v ?? ''),
    description: String(cell(`B${r}`)?.v ?? ''),
    unit: String(cell(`E${r}`)?.v ?? ''),
    unitPrice: price,
    programmedQty: qty,
    previous: prev,
    thisPeriod: 0,
    remarks: '',
  });
  excelExpect.push({
    row: r,
    toDate: Number(cell(`K${r}`)?.v ?? 0),
    thisPeriod: Number(cell(`J${r}`)?.v ?? 0),
    wtAccomp: Number(cell(`L${r}`)?.v ?? 0) * 100,
    remarks: String(cell(`M${r}`)?.v ?? ''),
  });
}

for (let r = 11; r <= 32; r++) {
  if ((sampleRows as readonly number[]).includes(r)) continue;
  const qty = Number(cell(`D${r}`)?.v ?? 0);
  const price = Number(cell(`F${r}`)?.v ?? 0);
  if (!qty && !price) continue;
  const itemNo = String(cell(`A${r}`)?.v ?? '');
  if (!itemNo || itemNo === 'I' || itemNo === 'II.' || itemNo === 'III.') continue;
  items.push({
    id: `r${r}`,
    itemNo,
    description: String(cell(`B${r}`)?.v ?? ''),
    unit: String(cell(`E${r}`)?.v ?? ''),
    unitPrice: price,
    programmedQty: qty,
    previous: Number(cell(`I${r}`)?.v ?? 0) || 0,
    thisPeriod: 0,
    remarks: '',
  });
}

const { items: computed, totals } = computeWorkItems(items);
const lines: string[] = [];
lines.push(`Excel G34 total=${totalContract}`);
lines.push(`App totalContract=${totals.totalContractAmount}`);
lines.push(`delta total=${Math.abs(totals.totalContractAmount - totalContract)}`);

let ok = Math.abs(totals.totalContractAmount - totalContract) < 0.02;

for (const expect of excelExpect) {
  const row = computed.find((i) => i.id === `r${expect.row}`)!;
  const toDateOk = Math.abs(row.toDate - expect.toDate) < 0.02;
  const thisOk = Math.abs(row.thisPeriod - expect.thisPeriod) < 0.02;
  const wtOk = Math.abs(row.accomplishmentWeightPct - expect.wtAccomp) < 0.02;
  const remOk = row.status === expect.remarks;
  lines.push(
    [
      `row ${expect.row} ${row.itemNo}`,
      `toDate app=${row.toDate} excel=${expect.toDate} ok=${toDateOk}`,
      `thisPeriod app=${row.thisPeriod} excel=${expect.thisPeriod} ok=${thisOk}`,
      `wt% app=${row.accomplishmentWeightPct} excel=${expect.wtAccomp} ok=${wtOk}`,
      `remarks app="${row.status}" excel="${expect.remarks}" ok=${remOk}`,
      `check ${swaToDateAmount(row.programmedQty, row.unitPrice, row.unit)} / ${swaThisPeriodAmount(row.toDate, row.previous)}`,
    ].join(' | '),
  );
  if (!toDateOk || !thisOk || !wtOk || !remOk) ok = false;
}

lines.push(ok ? 'SWA_EXCEL_OK' : 'SWA_EXCEL_FAIL');
writeFileSync('scripts/swa-excel-verify.txt', lines.join('\n'));
console.log(lines.join('\n'));
