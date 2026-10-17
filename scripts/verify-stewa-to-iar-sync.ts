import assert from 'node:assert/strict';
import {
  pickProjectStewa,
  stewaPlannedPct,
  pickProjectSwa,
  swaPhysicalAccomplishmentPct,
} from '../src/lib/iarProgress';
import { buildOfficialIarHtml } from '../src/lib/officialReportHtml';
import type { SwaStewaReport } from '../src/lib/swaStewaApi';

console.log('--- Testing STEWA -> IAR Planned % Synchronization ---');

// Reference STEWA from user screenshot:
// Notice to Proceed: December 26, 2025
// Suspension: 179
// Elapsed: 7
// Actual: 2.57%
// Planned: 1.33%
// Slippage: 1.24%
const stewaReport: SwaStewaReport = {
  id: 'stewa-1',
  report_number: 'STEWA-2026-0001',
  project_id: 'proj-1',
  report_type: 'STEWA',
  status: 'draft',
  created_at: '2026-10-10T08:00:00.000Z',
  line_items: [],
  report_data: {
    report_date: '2026-07-09',
    notice_to_proceed: '2025-12-26',
    expiry_date: '2026-04-09',
    approved_time_suspension: '179',
    calendar_days_elapsed: '7',
    percent_actual: '2.57',
    percent_planned: '1.33', // Line 12 in the screenshot
    slippage: '1.24',
    period_start: '2026-01-04',
    period_end: '2026-07-09',
    period_covered: 'January 04, 2026 to July 09, 2026',
    week_covered: 'July 6–9, 2026',
  },
};

// 1. Verify stewaPlannedPct extracts exact saved value from STEWA without separate formula
const plannedPct = stewaPlannedPct(stewaReport);
console.log('Extracted STEWA Planned %:', plannedPct);
assert.equal(plannedPct, 1.33, 'Must read 1.33 directly from STEWA saved percent_planned');

// 2. Corresponding SWA for the same period
const swaReport: SwaStewaReport = {
  id: 'swa-1',
  report_number: 'SWA-2026-0001',
  project_id: 'proj-1',
  report_type: 'SWA',
  status: 'draft',
  created_at: '2026-10-10T07:55:00.000Z',
  line_items: [],
  report_data: {
    as_of_range: '1',
    as_of_start: '2026-07-06',
    as_of_end: '2026-07-09',
    report_date: '2026-07-09',
    percent_actual: '2.57',
  },
};

const allReports: SwaStewaReport[] = [stewaReport, swaReport];

// 3. Corresponding IAR created for the reporting period (report_date = 2026-07-06 or 2026-07-09)
const iarDate = '2026-07-06';
const iarData = {
  report_date: iarDate,
  week_covered: 'July 6–9, 2026',
};

const matchedSwa = pickProjectSwa(allReports, iarDate);
assert(matchedSwa != null, 'Must match SWA for the reporting period');
assert.equal(matchedSwa.report_number, 'SWA-2026-0001');

const matchedStewa = pickProjectStewa(allReports, iarDate, matchedSwa, iarData);
assert(matchedStewa != null, 'Must match corresponding STEWA for the same reporting period');
assert.equal(matchedStewa.report_number, 'STEWA-2026-0001');

const matchedPlanned = stewaPlannedPct(matchedStewa);
assert.equal(matchedPlanned, 1.33, 'Matched STEWA Planned % must be 1.33%');

// 4. Verify IAR report HTML (View / Preview / Print / PDF)
const populatedIar: SwaStewaReport = {
  id: 'iar-1',
  report_number: 'IAR-2026-0001',
  project_id: 'proj-1',
  report_type: 'IAR',
  status: 'draft',
  created_at: '2026-10-10T08:05:00.000Z',
  line_items: [],
  report_data: {
    report_date: '2026-07-06',
    week_covered: 'July 6–9, 2026',
    orig_target: String(matchedPlanned),
    rev_target: String(matchedPlanned),
    percent_planned: String(matchedPlanned),
    actual_progress: '2.57',
    variance: '1.24',
    progress_remarks: 'On-going',
    progress_source: `STEWA ${matchedStewa.report_number} · SWA ${matchedSwa.report_number}`,
  },
};

const iarHtml = buildOfficialIarHtml(populatedIar);
console.log('Testing IAR HTML output...');
assert(iarHtml.includes('<td>1.33%</td>'), 'IAR HTML must show Orig. Target and Rev. Target as 1.33%');
assert(iarHtml.includes('<td>2.57%</td>'), 'IAR HTML must show Actual as 2.57%');
assert(iarHtml.includes('<td>1.24%</td>'), 'IAR HTML must show Variance as 1.24%');

// 5. Verify IAR does NOT pull Planned % from a different STEWA from an unrelated reporting period
const unrelatedOldStewa: SwaStewaReport = {
  id: 'stewa-old',
  report_number: 'STEWA-2025-0001',
  project_id: 'proj-1',
  report_type: 'STEWA',
  status: 'approved',
  created_at: '2025-05-01T08:00:00.000Z',
  line_items: [],
  report_data: {
    report_date: '2025-05-01',
    period_start: '2025-01-01',
    period_end: '2025-05-01',
    percent_planned: '88.50',
  },
};

const otherPeriodReports: SwaStewaReport[] = [unrelatedOldStewa];
// Looking for STEWA for period '2026-11-20' when only old 2025 STEWA exists
const noMatch = pickProjectStewa(otherPeriodReports, '2026-11-20', null, { report_date: '2026-11-20' });
assert.equal(noMatch, null, 'Must NOT pull from an unrelated STEWA from a different reporting period');

console.log('ALL STEWA -> IAR SYNCHRONIZATION TESTS PASSED!');
