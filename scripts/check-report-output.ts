import { buildOfficialReportHtml } from '../src/lib/officialReportHtml';
import type { SwaStewaReport } from '../src/lib/swaStewaApi';

const swa = buildOfficialReportHtml({
  id: '1',
  report_number: 'SWA-1',
  project_id: 'p',
  report_type: 'SWA',
  status: 'draft',
  created_at: '',
  project_name: 'Stored project',
  report_data: {
    project_name: 'Typed Road',
    location: 'Carig',
    contractor: 'Acme Builders',
    contract_amount: '1200',
    report_date: '2026-09-27',
    less_reason: 'Retention',
    less_amount: '10',
    sig_engineer_1_name: 'Ana Reyes',
    sig_engineer_1_initials: 'AR',
  },
  line_items: [
    {
      id: '1',
      itemNo: '100',
      snapshotItemNo: 'OLD',
      description: 'Edited description',
      snapshotDescription: 'Catalog description',
      unit: 'Meter',
      snapshotUnit: 'kg',
      unitPrice: 10,
      programmedQty: 2,
      revisedQty: 0,
      previous: 0,
      thisPeriod: 3,
      toDateInput: 4,
      remarks: 'Site note',
    },
  ],
} as SwaStewaReport);

const iar = buildOfficialReportHtml({
  id: '2',
  report_number: 'IAR-1',
  project_id: 'p',
  report_type: 'IAR',
  status: 'draft',
  created_at: '',
  report_data: {
    report_date: '2026-09-01',
    contract_number: 'C-9',
    municipality: 'Tuao',
    project_title: 'Bridge',
    contractor: 'Acme',
    contractor_representative: 'Jose Cruz',
    week_covered: 'Week 3',
    problems_remarks: 'Rain',
    orig_target: '10',
    rev_target: '12',
    actual_progress: '8',
    variance: '-4',
    progress_remarks: 'Behind',
    accomplishment_items: [
      { item_no: '200', description: 'Excavation', location: 'Sta 1', physical_qty: '5', billable_qty: '4', unit: 'cu.m.' },
    ],
    activities: ['Pour concrete'],
    field_instructions: ['Compact base'],
    manpower: [{ description: 'Laborer', quantity: '6' }],
    equipment: [{ description: 'Roller', quantity: '1' }],
    sig_contractor_name: 'Jose Cruz',
    sig_contractor_initials: 'JC',
  },
  line_items: [],
  approval_flow: {
    engineer_1: {
      approved_by: 'u1',
      approved_role: 'engineer_1',
      approved_at: '2026-09-27T00:00:00.000Z',
      signatory_name: 'Old Snapshot',
      signatory_initials: 'OS',
      signatory_designation: 'Engineer I',
    },
  },
} as SwaStewaReport);

function expectIncludes(html: string, text: string, label: string) {
  if (!html.includes(text)) throw new Error(`${label} missing: ${text}`);
}
function expectExcludes(html: string, text: string, label: string) {
  if (html.includes(text)) throw new Error(`${label} unexpectedly includes: ${text}`);
}

expectIncludes(swa, 'Typed Road', 'swa project');
expectIncludes(swa, 'Carig', 'swa location');
expectIncludes(swa, 'Acme Builders', 'swa contractor');
expectIncludes(swa, 'Edited description', 'swa description');
expectExcludes(swa, 'Catalog description', 'swa old description');
expectIncludes(swa, 'Meter', 'swa unit');
expectExcludes(swa, '>kg<', 'swa old unit');
expectIncludes(swa, 'Site note', 'swa remarks');
expectIncludes(swa, 'Ana Reyes', 'swa signatory');
expectIncludes(swa, 'AR', 'swa initials');
expectIncludes(swa, 'Retention', 'swa less');

expectIncludes(iar, 'Jose Cruz', 'iar representative');
expectIncludes(iar, 'Week 3', 'iar week');
expectIncludes(iar, 'Excavation', 'iar item');
expectIncludes(iar, 'cu.m.', 'iar unit');
expectIncludes(iar, 'Pour concrete', 'iar activity');
expectIncludes(iar, 'Compact base', 'iar instruction');
expectIncludes(iar, 'Rain', 'iar remarks');
expectIncludes(iar, 'Laborer', 'iar manpower');
expectIncludes(iar, 'Roller', 'iar equipment');
expectIncludes(iar, 'Behind', 'iar progress note');
expectIncludes(iar, 'Old Snapshot', 'iar snapshot name');
expectIncludes(iar, 'PEO Engineer I', 'iar position');

const stewa = buildOfficialReportHtml({
  id: '3',
  report_number: 'STEWA-1',
  project_id: 'p',
  report_type: 'STEWA',
  status: 'draft',
  created_at: '',
  report_data: {
    project_name: 'River Road',
    location: 'Carig',
    contract_amount: '5000',
    contractor: 'Acme',
    report_date: '2026-09-27',
    period_covered: 'September',
    contract_duration: '120',
    ntp_date: '2026-01-01',
    expiry_date: '2026-05-01',
    time_extensions: '10',
    suspension_order: 'SO-1',
    revised_contract_duration: '130',
    revised_expiry_date: '2026-05-11',
    calendar_days_elapsed: '40',
    actual_percent: '30',
    planned_percent: '35',
    slippage_percent: '-5',
    remarks: 'On track',
    submitted_by_name: 'Engineer I',
    noted_by_name: 'Engineer III',
    sig_engineer_1_name: 'Luis Santos',
    sig_engineer_1_initials: 'LS',
  },
  line_items: [],
} as SwaStewaReport);

expectIncludes(stewa, 'River Road', 'stewa project');
expectIncludes(stewa, 'September', 'stewa period');
expectIncludes(stewa, 'On track', 'stewa remarks');
expectIncludes(stewa, 'Luis Santos', 'stewa signatory');
expectIncludes(stewa, 'LS', 'stewa initials');
expectIncludes(stewa, 'Engineer I', 'stewa submitted');
expectIncludes(stewa, 'Engineer III', 'stewa noted');

console.log('ok');
