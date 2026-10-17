import { computeWorkItems, formatMoney, formatPct, type WorkItem } from '../src/lib/workItems';
import { buildOfficialSwaHtml } from '../src/lib/officialReportHtml';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// 1. Setup sample items matching the user's Excel reference:
// Suppose total contract cost = 3,000,000 PHP (or whatever makes 76,897.75 equal to 2.563% ~ 2.57% or exact items)
// Let's create items with programmedQty & unitPrice matching the weights in the screenshot:
// Item 1: Weight 0.42% (Cost 12,600) -> This Period: 0 -> Accomplished: 0.00%
// Item 2: Weight 0.52% (Cost 15,561) -> This Period: 7,780.50 -> Accomplished: 0.26%
// Item 3: Weight 0.99% (Cost 29,488.20) -> This Period: 14,744.10 -> Accomplished: 0.49%
// Item 4: Weight 1.72% (Cost 51,508.86) -> This Period: 25,754.43 -> Accomplished: 0.86%
// Item 5: Weight 0.92% (Cost 27,600) -> This Period: 0 -> Accomplished: 0.00%
// Item 6: Weight 0.56% (Cost 16,776.86) -> This Period: 16,776.86 -> Accomplished: 0.56%
// Item 7: Weight 0.79% (Cost 29,604.65) -> This Period: 11,841.86 -> Accomplished: 0.40%
// Item 8: Remainder weight to make total = 100.00%

const totalContract = 2992490.48; // chosen so item costs give exact weights

const sampleItems: WorkItem[] = [
  {
    id: 'item-1',
    itemNo: '100(1)',
    description: 'Clearing and Grubbing',
    unit: 'ha',
    unitPrice: 12568.46,
    programmedQty: 1,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
  {
    id: 'item-2',
    itemNo: '101(1)',
    description: 'Removal of Structures',
    unit: 'ea',
    unitPrice: 15561,
    programmedQty: 1,
    previous: 0,
    thisPeriod: 7780.50,
    remarks: '',
  },
  {
    id: 'item-3',
    itemNo: '102(1)',
    description: 'Unsuitable Excavation',
    unit: 'cu.m',
    unitPrice: 29488.20,
    programmedQty: 1,
    previous: 0,
    thisPeriod: 14744.10,
    remarks: '',
  },
  {
    id: 'item-4',
    itemNo: '103(1)',
    description: 'Structure Excavation',
    unit: 'cu.m',
    unitPrice: 51508.86,
    programmedQty: 1,
    previous: 0,
    thisPeriod: 25754.43,
    remarks: '',
  },
  {
    id: 'item-5',
    itemNo: '104(1)',
    description: 'Embankment',
    unit: 'cu.m',
    unitPrice: 27530.91,
    programmedQty: 1,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
  {
    id: 'item-6',
    itemNo: '105(1)',
    description: 'Subgrade Preparation',
    unit: 'sq.m',
    unitPrice: 16776.86,
    programmedQty: 1,
    previous: 0,
    thisPeriod: 16776.86,
    remarks: '',
  },
  {
    id: 'item-7',
    itemNo: '200(1)',
    description: 'Aggregate Subbase Course',
    unit: 'cu.m',
    unitPrice: 23683.72,
    programmedQty: 1,
    previous: 0,
    thisPeriod: 11841.86,
    remarks: '',
  },
  {
    id: 'item-8',
    itemNo: '311(1)',
    description: 'PCC Pavement',
    unit: 'sq.m',
    unitPrice: totalContract - (12568.46 + 15561 + 29488.20 + 51508.86 + 27530.91 + 16776.86 + 23683.72),
    programmedQty: 1,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  },
];

// 2. Test computeWorkItems
const { items, totals } = computeWorkItems(sampleItems);

// Check TO DATE = PREVIOUS + THIS PERIOD
for (const item of items) {
  assert(item.toDate === item.previous + item.thisPeriod, `Item ${item.itemNo} toDate mismatch: ${item.toDate} !== ${item.previous} + ${item.thisPeriod}`);
}

// Check specific values
const item2 = items.find((i) => i.itemNo === '101(1)')!;
assert(item2.toDate === 7780.50, `Item 2 toDate expected 7780.50, got ${item2.toDate}`);
assert(formatMoney(item2.toDate) === '7,780.50', `Item 2 formatted toDate expected 7,780.50, got ${formatMoney(item2.toDate)}`);
assert(formatPct(item2.accomplishmentWeightPct) === '0.26', `Item 2 accomp weight expected 0.26, got ${formatPct(item2.accomplishmentWeightPct)}`);

const item3 = items.find((i) => i.itemNo === '102(1)')!;
assert(formatPct(item3.accomplishmentWeightPct) === '0.49', `Item 3 accomp weight expected 0.49, got ${formatPct(item3.accomplishmentWeightPct)}`);

const item4 = items.find((i) => i.itemNo === '103(1)')!;
assert(formatPct(item4.accomplishmentWeightPct) === '0.86', `Item 4 accomp weight expected 0.86, got ${formatPct(item4.accomplishmentWeightPct)}`);

const item6 = items.find((i) => i.itemNo === '105(1)')!;
assert(formatPct(item6.accomplishmentWeightPct) === '0.56', `Item 6 accomp weight expected 0.56, got ${formatPct(item6.accomplishmentWeightPct)}`);

const item7 = items.find((i) => i.itemNo === '200(1)')!;
assert(formatPct(item7.accomplishmentWeightPct) === '0.40', `Item 7 accomp weight expected 0.40, got ${formatPct(item7.accomplishmentWeightPct)}`);

// Check totals
assert(formatMoney(totals.totalThisAccomplishment) === '76,897.75', `Total this period expected 76,897.75, got ${formatMoney(totals.totalThisAccomplishment)}`);
assert(formatMoney(totals.totalToDateAccomplishment) === '76,897.75', `Total to date expected 76,897.75, got ${formatMoney(totals.totalToDateAccomplishment)}`);
assert(formatPct(totals.totalToDateWeightPct) === '2.57', `Total accomp weight expected 2.57, got ${formatPct(totals.totalToDateWeightPct)}`);
assert(formatPct(totals.totalWeightPct) === '100.00', `Total weight expected 100.00, got ${formatPct(totals.totalWeightPct)}`);

// Check summation rule: 2.57% MUST be the summation of accomplished Weight % values
const directSum = items.reduce((s, i) => s + i.accomplishmentWeightPct, 0);
assert(Math.abs(directSum - totals.totalToDateWeightPct) < 1e-9, `Total accomplished weight must be direct sum of items: ${directSum} vs ${totals.totalToDateWeightPct}`);
assert(formatPct(directSum) === '2.57', `Direct sum expected 2.57%, got ${formatPct(directSum)}`);
assert(formatPct(totals.pctThisAccomplishment) === '2.57', `% This Accomplishment must equal total accomplished weight: ${formatPct(totals.pctThisAccomplishment)} vs 2.57`);

// 3. Test recalculation when Previous changes
const itemsWithPrevious = sampleItems.map((item) =>
  item.itemNo === '101(1)' ? { ...item, previous: 2000, thisPeriod: 5780.50 } : item
);
const recalculation = computeWorkItems(itemsWithPrevious);
const recItem2 = recalculation.items.find((i) => i.itemNo === '101(1)')!;
assert(recItem2.toDate === 2000 + 5780.50, `Item 2 toDate expected 7780.50, got ${recItem2.toDate}`);
assert(formatMoney(recalculation.totals.totalThisAccomplishment) === '74,897.75', 'Recalculated this period match');
assert(formatMoney(recalculation.totals.totalToDateAccomplishment) === '76,897.75', 'Recalculated to date match');
assert(formatPct(recalculation.totals.totalToDateWeightPct) === '2.57', 'Recalculated accomp weight match');
assert(formatPct(recalculation.totals.pctThisAccomplishment) === '2.57', 'Recalculated % This Accomplishment must match total accomplished weight 2.57%');

// 4. Test User Scenario: Sum of %W = 67.92% vs % This Accomplishment (previously 64.35%)
// Setup items where Previous has 3.57% weight and This Period has 64.35% weight:
const scenarioContract = 1000000;
const scenarioItems: WorkItem[] = [
  {
    id: 's-1',
    itemNo: 'I',
    description: 'GENERAL REQUIREMENTS',
    unit: '',
    unitPrice: 0,
    programmedQty: 0,
    previous: 0,
    thisPeriod: 0,
  },
  {
    id: 's-2',
    itemNo: 'Item 1',
    description: 'Previous work completed earlier',
    unit: 'l.s.',
    unitPrice: 35700,
    programmedQty: 1,
    previous: 35700, // 3.57%
    thisPeriod: 0,
  },
  {
    id: 's-3',
    itemNo: 'Item 2',
    description: 'Work accomplished this period',
    unit: 'l.s.',
    unitPrice: 643500,
    programmedQty: 1,
    previous: 0,
    thisPeriod: 643500, // 64.35%
  },
  {
    id: 's-4',
    itemNo: 'Item 3',
    description: 'Future work not yet started',
    unit: 'l.s.',
    unitPrice: 320800,
    programmedQty: 1,
    previous: 0,
    thisPeriod: 0, // 32.08%
  },
];

const scenarioResult = computeWorkItems(scenarioItems);
assert(formatPct(scenarioResult.totals.totalContractAmount) === '1000000.00', 'Total Project Cost correct');
assert(formatPct(scenarioResult.totals.totalWeightPct) === '100.00', 'Total weight % = 100.00%');
assert(formatMoney(scenarioResult.totals.totalThisAccomplishment) === '643,500.00', 'Total This Accomplishment amount remains correct');
assert(formatMoney(scenarioResult.totals.totalToDateAccomplishment) === '679,200.00', 'Total To Date amount remains correct');

// Verify row-level %W
const row1 = scenarioResult.items.find((i) => i.itemNo === 'Item 1')!;
const row2 = scenarioResult.items.find((i) => i.itemNo === 'Item 2')!;
const row3 = scenarioResult.items.find((i) => i.itemNo === 'Item 3')!;
assert(formatPct(row1.accomplishmentWeightPct) === '3.57', `Row 1 %W = 3.57%, got ${formatPct(row1.accomplishmentWeightPct)}`);
assert(formatPct(row2.accomplishmentWeightPct) === '64.35', `Row 2 %W = 64.35%, got ${formatPct(row2.accomplishmentWeightPct)}`);
assert(formatPct(row3.accomplishmentWeightPct) === '0.00', `Row 3 %W = 0.00%, got ${formatPct(row3.accomplishmentWeightPct)}`);

const billableRowsSum = scenarioResult.items
  .filter((i) => !i.isSection)
  .reduce((s, i) => s + i.accomplishmentWeightPct, 0);

assert(formatPct(billableRowsSum) === '67.92', `Sum of row %W = 67.92%, got ${formatPct(billableRowsSum)}`);
assert(formatPct(scenarioResult.totals.totalToDateWeightPct) === '67.92', `Total accomplished weight = 67.92%`);
assert(formatPct(scenarioResult.totals.pctThisAccomplishment) === '67.92', `% This Accomplishment must equal 67.92%, got ${formatPct(scenarioResult.totals.pctThisAccomplishment)}`);

// SUM(valid row %W) = % This Accomplishment
assert(
  formatPct(billableRowsSum) === formatPct(scenarioResult.totals.pctThisAccomplishment),
  `SUM(valid row %W) must strictly match % This Accomplishment: ${formatPct(billableRowsSum)} === ${formatPct(scenarioResult.totals.pctThisAccomplishment)}`
);

// 5. Test HTML output
const html = buildOfficialSwaHtml({
  report_number: 'SWA-2026-001',
  report_data: { project_name: 'Sample Road Project', contract_amount: totalContract },
  line_items: sampleItems,
  project_name: 'Sample Road Project',
  approval_flow: undefined,
});

assert(html.includes('76,897.75'), 'HTML must include 76,897.75');
assert(html.includes('2.57%'), 'HTML must include 2.57%');
assert(html.includes('100.00%'), 'HTML must include 100.00%');
assert(!html.includes('NaN'), 'HTML must never contain NaN');

// HTML for user scenario
const scenarioHtml = buildOfficialSwaHtml({
  report_number: 'SWA-2026-002',
  report_data: { project_name: 'User Scenario Project', contract_amount: scenarioContract },
  line_items: scenarioItems,
  project_name: 'User Scenario Project',
  approval_flow: undefined,
});

assert(scenarioHtml.includes('67.92%'), 'Scenario HTML must include 67.92% in both table and summary');
assert(scenarioHtml.includes('643,500.00'), 'Scenario HTML must include 643,500.00 for Total This Accomplishment');
assert(scenarioHtml.includes('1,000,000.00'), 'Scenario HTML must include 1,000,000.00 for Total Project Cost');

console.log('SWA_ACCOMPLISHMENT_TABLE_OK');
