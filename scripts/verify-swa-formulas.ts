/**
 * Unit-style check of the exact SWA formulas provided by users.
 */
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import {
  computeWorkItems,
  formatPct,
  swaThisPeriodAmount,
  swaToDateAmount,
  isSwaSectionHeading,
  swaWeightPct,
  workItemRemarksStatus,
  type WorkItem,
} from '../src/lib/workItems';

const samples: Array<{
  label: string;
  unit: string;
  qty: number;
  unitPrice: number;
  previous: number;
  lumpSum: boolean;
}> = [
  { label: 'B.7 L.S.', unit: 'L.S.', qty: 1, unitPrice: 15561, previous: 0, lumpSum: true },
  { label: '101(3)b1 sqm', unit: 'sqm', qty: 88.45, unitPrice: 582.35, previous: 0, lumpSum: false },
  { label: 'each', unit: 'each', qty: 4, unitPrice: 250, previous: 100, lumpSum: false },
  { label: 'cum', unit: 'cum', qty: 3, unitPrice: 80, previous: 0, lumpSum: false },
];

// Pad with other contract rows so Total Project Cost is realistic
const filler: WorkItem[] = [
  {
    id: 'fill',
    itemNo: 'X',
    description: 'Filler',
    unit: 'ls',
    unitPrice: 1000000,
    programmedQty: 2,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
];

const items: WorkItem[] = [
  ...samples.map((s, i) => ({
    id: `s${i}`,
    itemNo: s.label,
    description: s.label,
    unit: s.unit,
    unitPrice: s.unitPrice,
    programmedQty: s.qty,
    previous: s.previous,
    thisPeriod: 0,
    remarks: '',
  })),
  ...filler,
];

const { items: computed, totals } = computeWorkItems(items);
const totalProjectCost = totals.totalContractAmount;
const lines: string[] = [`Total Project Cost = ${totalProjectCost}`];
let ok = true;

for (let i = 0; i < samples.length; i++) {
  const s = samples[i]!;
  const row = computed.find((r) => r.id === `s${i}`)!;
  const expectToDate = s.lumpSum ? (s.qty / 2) * s.unitPrice : s.qty * s.unitPrice;
  const expectThis = expectToDate - s.previous;
  const expectContract = s.qty * s.unitPrice;
  const roundedPct = (amount: number) =>
    (Math.round((amount / totalProjectCost) * 1e5) / 1e5) * 100;
  const expectWeight = roundedPct(expectContract);
  const expectWtAccomp = roundedPct(expectToDate);
  const expectRemarks = workItemRemarksStatus(expectWtAccomp, expectWeight);

  const checks = [
    ['TO DATE', row.toDate, expectToDate, swaToDateAmount(s.qty, s.unitPrice, s.unit)],
    ['THIS PERIOD', row.thisPeriod, expectThis, swaThisPeriodAmount(expectToDate, s.previous)],
    ['WEIGHT %', row.weightPct, expectWeight, swaWeightPct(expectContract, totalProjectCost)],
    [
      'WT% ACCOMP',
      row.accomplishmentWeightPct,
      expectWtAccomp,
      swaWeightPct(expectToDate, totalProjectCost),
    ],
  ] as const;

  for (const [name, got, expect, helper] of checks) {
    const pass = Math.abs(got - expect) < 1e-9 && Math.abs(helper - expect) < 1e-9;
    lines.push(`${s.label} ${name}: got=${got} expect=${expect} ok=${pass}`);
    if (!pass) ok = false;
  }
  const remOk = row.status === expectRemarks;
  lines.push(`${s.label} Remarks: got="${row.status}" expect="${expectRemarks}" ok=${remOk}`);
  if (!remOk) ok = false;
}

const variants: Array<{ unit: string; lumpSum: boolean }> = [
  { unit: 'L.S.', lumpSum: true },
  { unit: 'LS', lumpSum: true },
  { unit: 'l.s.', lumpSum: true },
  { unit: 'lump sum', lumpSum: true },
  { unit: 'sq.m.', lumpSum: false },
  { unit: 'sqm', lumpSum: false },
  { unit: 'each', lumpSum: false },
  { unit: 'cum', lumpSum: false },
  { unit: 'cu.m.', lumpSum: false },
];
for (const variant of variants) {
  const qty = 2;
  const price = 100;
  const { items: rows } = computeWorkItems([
    {
      id: 'v',
      itemNo: '1',
      description: 'variant',
      unit: variant.unit === 'L.S.' ? 'sqm' : variant.unit,
      snapshotUnit: variant.unit,
      unitPrice: price,
      programmedQty: qty,
      previous: 0,
      thisPeriod: 0,
      remarks: '',
    },
  ]);
  const got = rows[0]!.toDate;
  const expect = variant.lumpSum ? (qty / 2) * price : qty * price;
  const pass = Math.abs(got - expect) < 1e-9;
  lines.push(`unit "${variant.unit}" toDate=${got} expect=${expect} ok=${pass}`);
  if (!pass) ok = false;
}

const contract = 88.45 * 582.35;
const existing = computeWorkItems([
  {
    id: 'saved',
    itemNo: '101(3)b1',
    description: 'saved sqm row',
    unit: 'sqm',
    unitPrice: 582.35,
    programmedQty: 88.45,
    previous: 0,
    thisPeriod: 25754.43,
    remarks: '',
  },
]).items[0]!;
const existingOk = Math.abs(existing.toDate - contract) < 0.01 && Math.abs(existing.contractAmount - contract) < 0.01;
lines.push(`existing sqm 101(3)b1 toDate=${existing.toDate} contract=${existing.contractAmount} ok=${existingOk}`);
if (!existingOk) ok = false;

const overridden = computeWorkItems([
  {
    id: 'override',
    itemNo: '1',
    description: 'manual',
    unit: 'each',
    unitPrice: 100,
    programmedQty: 2,
    previous: 0,
    thisPeriod: 0,
    toDateInput: 40,
    remarks: '',
  },
]).items[0]!;
const overrideOk = overridden.toDate === 40 && overridden.thisPeriod === 40;
lines.push(`manual to-date override=${overridden.toDate} thisPeriod=${overridden.thisPeriod} ok=${overrideOk}`);
if (!overrideOk) ok = false;

const sectionCheck = computeWorkItems([
  {
    id: 'sec1',
    itemNo: 'I. OTHER GENERAL REQUIREMENTS',
    description: '',
    unit: 'sqm',
    unitPrice: 500,
    programmedQty: 10,
    previous: 20,
    thisPeriod: 0,
    remarks: '',
  },
  {
    id: 'pay',
    itemNo: '101(3)b1',
    description: 'Removal',
    unit: 'sqm',
    unitPrice: 582.35,
    programmedQty: 88.45,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
  {
    id: 'sec2',
    itemNo: 'II. SITE WORKS',
    description: '',
    unit: '',
    unitPrice: 0,
    programmedQty: 0,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
  {
    id: 'sec3',
    itemNo: 'III.',
    description: 'SUB-BASE COURSE',
    unit: '',
    unitPrice: 0,
    programmedQty: 0,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
  {
    id: 'bare',
    itemNo: 'IV',
    description: 'SURFACE COURSE',
    unit: '',
    unitPrice: 0,
    programmedQty: 0,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
]);
const pay = sectionCheck.items.find((row) => row.id === 'pay')!;
const headings = ['sec1', 'sec2', 'sec3', 'bare'].map(
  (id) => sectionCheck.items.find((row) => row.id === id)!,
);
const sectionBlank = headings.every(
  (row) =>
    row.isSection
    && row.contractAmount === 0
    && row.weightPct === 0
    && row.toDate === 0
    && row.thisPeriod === 0
    && row.accomplishmentWeightPct === 0
    && row.status === '',
);
const payContract = 88.45 * 582.35;
const sectionIgnored =
  Math.abs(sectionCheck.totals.totalContractAmount - payContract) < 0.01
  && Math.abs(pay.weightPct - 100) < 1e-9
  && !pay.isSection;
lines.push(`section rows blank=${sectionBlank} excluded from total=${sectionIgnored}`);
if (!sectionBlank || !sectionIgnored) ok = false;

const headingCases: Array<[string, boolean]> = [
  ['I. OTHER GENERAL REQUIREMENTS', true],
  ['II. SITE WORKS', true],
  ['III.', true],
  ['IV.', true],
  ['V. SURFACE COURSE', true],
  ['I', true],
  ['II.', true],
  ['101(3)b1', false],
  ['B.5', false],
  ['C.1', false],
];
for (const [label, expectHeading] of headingCases) {
  const got = isSwaSectionHeading(label);
  const pass = got === expectHeading;
  lines.push(`heading "${label}" section=${got} expect=${expectHeading} ok=${pass}`);
  if (!pass) ok = false;
}

const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');
const wb = XLSX.readFile('public/SWA-STEWA-RCBC.xlsx');
const sheet = wb.Sheets['SWA (July 6-9)']!;
const cell = (addr: string) => sheet[addr] as { v?: unknown; w?: string } | undefined;
const excelTotal = Number(cell('G34')?.v ?? 0);
const excelItems: WorkItem[] = [];
const excelWeights: Array<{ itemNo: string; excelPct: number; displayed: string }> = [];
for (let r = 10; r <= 32; r++) {
  const itemNo = String(cell(`A${r}`)?.v ?? '').trim();
  if (!itemNo) continue;
  const qty = Number(cell(`D${r}`)?.v ?? 0) || 0;
  const price = Number(cell(`F${r}`)?.v ?? 0) || 0;
  excelItems.push({
    id: `e${r}`,
    itemNo,
    description: String(cell(`B${r}`)?.v ?? ''),
    unit: String(cell(`E${r}`)?.v ?? ''),
    unitPrice: price,
    programmedQty: qty,
    previous: Number(cell(`I${r}`)?.v ?? 0) || 0,
    thisPeriod: 0,
    remarks: '',
  });
  const fraction = cell(`H${r}`)?.v;
  if (typeof fraction === 'number') {
    excelWeights.push({
      itemNo,
      excelPct: fraction * 100,
      displayed: String(cell(`H${r}`)?.w ?? ''),
    });
  }
}
const excelComputed = computeWorkItems(excelItems);
const totalOk = Math.abs(excelComputed.totals.totalContractAmount - excelTotal) < 0.02;
lines.push(
  `excel total=${excelTotal} app=${excelComputed.totals.totalContractAmount} ok=${totalOk}`,
);
if (!totalOk) ok = false;
for (const sample of ['B.5', 'B.7', 'B.9', '101(3)b1', '101(6)', '103(1)a', '105(1)', '200(1)', '311(1)c']) {
  const row = excelComputed.items.find((item) => item.itemNo === sample);
  const expect = excelWeights.find((item) => item.itemNo === sample);
  if (!row || !expect) {
    lines.push(`excel weight missing ${sample}`);
    ok = false;
    continue;
  }
  const pass = Math.abs(row.weightPct - expect.excelPct) < 0.0000001;
  const shown = formatPct(row.weightPct);
  const excelShown = expect.displayed.replace('%', '').trim();
  const displayOk = shown === excelShown;
  lines.push(
    `${sample} weight app=${row.weightPct} excel=${expect.excelPct} display ${shown} vs ${excelShown} ok=${pass && displayOk}`,
  );
  if (!pass || !displayOk) ok = false;
}
const excelSections = excelComputed.items.filter((item) =>
  ['I', 'II.', 'III.', 'IV.'].includes(item.itemNo),
);
const excelSectionOk =
  excelSections.length === 4
  && excelSections.every((item) => item.isSection && item.weightPct === 0 && item.contractAmount === 0);
lines.push(`excel section rows blank=${excelSectionOk}`);
if (!excelSectionOk) ok = false;

lines.push(ok ? 'SWA_FORMULA_OK' : 'SWA_FORMULA_FAIL');
writeFileSync('scripts/swa-formula-verify.txt', lines.join('\n'));
console.log(lines.join('\n'));
