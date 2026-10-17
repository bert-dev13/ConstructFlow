import assert from 'node:assert/strict';
import {
  formatReportDisplayDate,
  formatSwaAsOfLabel,
  formatExcelDate,
} from '../src/lib/stewaCalculations';
import { buildOfficialReportHtml } from '../src/lib/officialReportHtml';
import type { SwaStewaReport } from '../src/lib/swaStewaApi';

console.log('--- Testing formatReportDisplayDate & document date sources ---');

// 1. SWA with date range (The user example: "As of July 6–9, 2026")
const swaRangeReport: SwaStewaReport = {
  id: 'rpt-swa-1',
  report_number: 'SWA-2026-0001',
  project_id: 'proj-1',
  project_name: 'Test Project',
  report_type: 'SWA',
  status: 'draft',
  created_at: '2026-10-10T08:00:00.000Z',
  line_items: [],
  report_data: {
    as_of_range: '1',
    as_of_start: '2026-07-06',
    as_of_end: '2026-07-09',
    report_date: '2026-07-09',
  },
};

const swaRangeDisplay = formatReportDisplayDate(swaRangeReport);
console.log('SWA date range display:', swaRangeDisplay);
assert.equal(swaRangeDisplay, 'July 6–9, 2026', 'SWA with range must show "July 6–9, 2026"');

// Verify official report HTML also uses July 6–9, 2026
const swaHtml = buildOfficialReportHtml(swaRangeReport);
assert(
  swaHtml.includes('As of <u>July 6–9, 2026</u>'),
  'SWA official HTML preview must include "July 6–9, 2026"',
);

// 2. SWA with single date
const swaSingleReport: SwaStewaReport = {
  id: 'rpt-swa-2',
  report_number: 'SWA-2026-0002',
  project_id: 'proj-1',
  project_name: 'Test Project',
  report_type: 'SWA',
  status: 'approved',
  created_at: '2026-10-10T08:00:00.000Z',
  line_items: [],
  report_data: {
    as_of_range: '',
    report_date: '2026-07-09',
  },
};

const swaSingleDisplay = formatReportDisplayDate(swaSingleReport);
console.log('SWA single date display:', swaSingleDisplay);
assert.equal(swaSingleDisplay, 'July 09, 2026', 'SWA single date must show "July 09, 2026"');

// 3. SWA with edited document date (must reflect edited date, NOT createdAt)
const swaEditedReport: SwaStewaReport = {
  ...swaRangeReport,
  report_data: {
    as_of_range: '1',
    as_of_start: '2026-08-03',
    as_of_end: '2026-08-07',
    report_date: '2026-08-07',
  },
};
const swaEditedDisplay = formatReportDisplayDate(swaEditedReport);
console.log('SWA edited date display:', swaEditedDisplay);
assert.equal(swaEditedDisplay, 'August 3–7, 2026', 'Edited SWA must reflect updated dates');

// 4. STEWA with report_date
const stewaReport: SwaStewaReport = {
  id: 'rpt-stewa-1',
  report_number: 'STEWA-2026-0001',
  project_id: 'proj-1',
  project_name: 'Test Project',
  report_type: 'STEWA',
  status: 'pending_review',
  created_at: '2026-10-10T08:00:00.000Z',
  line_items: [],
  report_data: {
    report_date: '2026-07-09',
    period_start: '2026-06-01',
    period_end: '2026-07-09',
  },
};

const stewaDisplay = formatReportDisplayDate(stewaReport);
console.log('STEWA report date display:', stewaDisplay);
assert.equal(stewaDisplay, 'July 09, 2026', 'STEWA must show its document report date "July 09, 2026"');

const stewaHtml = buildOfficialReportHtml(stewaReport);
assert(
  stewaHtml.includes('As of <u>July 09, 2026</u>'),
  'STEWA official HTML must use document date',
);

// 5. IAR with report_date
const iarReport: SwaStewaReport = {
  id: 'rpt-iar-1',
  report_number: 'IAR-2026-0001',
  project_id: 'proj-1',
  project_name: 'Test Project',
  report_type: 'IAR',
  status: 'rejected',
  created_at: '2026-10-10T08:00:00.000Z',
  line_items: [],
  report_data: {
    report_date: '2026-07-09',
    week_covered: 'July 6–9, 2026',
  },
};

const iarDisplay = formatReportDisplayDate(iarReport);
console.log('IAR report date display:', iarDisplay);
assert.equal(iarDisplay, 'July 09, 2026', 'IAR must show document report date "July 09, 2026"');

const iarHtml = buildOfficialReportHtml(iarReport);
assert(
  iarHtml.includes('Date:</td><td class="val">July 09, 2026</td>'),
  'IAR official HTML must use document date',
);

// 6. IAR with only week_covered
const iarWeekReport: SwaStewaReport = {
  id: 'rpt-iar-2',
  report_number: 'IAR-2026-0002',
  project_id: 'proj-1',
  project_name: 'Test Project',
  report_type: 'IAR',
  status: 'draft',
  created_at: '2026-10-10T08:00:00.000Z',
  line_items: [],
  report_data: {
    week_covered: 'July 6–9, 2026',
  },
};

const iarWeekDisplay = formatReportDisplayDate(iarWeekReport);
console.log('IAR week covered display:', iarWeekDisplay);
assert.equal(iarWeekDisplay, 'July 6–9, 2026', 'IAR fallback to week_covered');

// 7. Report with no document date set yet (fallback to created_at)
const unsetDateReport: SwaStewaReport = {
  id: 'rpt-unset-1',
  report_number: 'SWA-NEW',
  project_id: 'proj-1',
  report_type: 'SWA',
  status: 'draft',
  created_at: '2026-10-10T08:00:00.000Z',
  line_items: [],
  report_data: {},
};

const unsetDisplay = formatReportDisplayDate(unsetDateReport);
console.log('Unset report display:', unsetDisplay);
assert.equal(unsetDisplay, 'October 10, 2026', 'Fallback to created_at when document has no date set');

console.log('ALL TESTS PASSED!');
