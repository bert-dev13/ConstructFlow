import type { SwaStewaReport } from './swaStewaApi';
import { BASE_URL } from './paths';
import {
  computeWorkItems,
  formatMoney,
  formatPct,
  type WorkItem,
  type WorkItemComputed,
} from './workItems';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truthyFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function lessAmountOf(data: Record<string, unknown>): number {
  const less = data.less_amount ?? data.lessAmount;
  if (less != null && String(less) !== '') return Number(less) || 0;
  return Number(data.advance_payment ?? data.advancePayment ?? 0) || 0;
}

function lessReasonOf(data: Record<string, unknown>): string {
  const reason = String(data.less_reason ?? data.lessReason ?? '').trim();
  if (reason) return reason;
  return lessAmountOf(data) > 0 ? 'Advance Payment' : '';
}

function formatReportDate(value: unknown, allowEmpty = false): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return allowEmpty
      ? ''
      : new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
  }
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return raw;
  return new Date(ts).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (value != null && String(value).trim() !== '') return String(value);
  }
  return '';
}

function moneyField(data: Record<string, unknown>, ...keys: string[]): string {
  const raw = field(data, ...keys);
  if (!raw) return '';
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? formatMoney(n) : escapeHtml(raw);
}

/** Absolute public asset URL so logos load inside srcDoc iframes. */
function assetUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  return `${origin}${base}${path.replace(/^\//, '')}`;
}

function sealImg(src: string, alt: string): string {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="68" height="68" style="width:68px;height:68px;object-fit:contain;display:block;border:0" />`;
}

/** Shared provincial letterhead — PGC seal left, PEO seal right. */
function letterheadHtml(): string {
  const pgc = sealImg(assetUrl('img/pgc.jpg'), 'Province of Cagayan Official Seal');
  const peo = sealImg(assetUrl('img/peo.webp'), "Provincial Engineer's Office Seal");
  return `<table class="letterhead" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td class="seal seal-left">${pgc}</td>
    <td class="header-text">
      <div class="gov">Republic of the Philippines</div>
      <div class="prov">PROVINCE OF CAGAYAN</div>
      <div class="addr">Capitol Hills, Tuguegarao City</div>
      <div class="office">PROVINCIAL ENGINEER'S OFFICE</div>
    </td>
    <td class="seal seal-right">${peo}</td>
  </tr>
</table>`;
}

const SHARED_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0; padding:18px 22px 48px; background:#fff; }
  .report-no { font-size: 7.5pt; color: #555; text-align: right; margin: 0 0 8px 0; }
  h3, .doc-title { text-align: center; margin: 10px 0 6px; font-size: 11pt; font-weight: bold; letter-spacing: 0.2px; }
  .meta { margin-bottom: 12px; font-size: 9pt; text-align: center; line-height: 1.35; }
  .letterhead { width: 100%; border-collapse: collapse; margin: 0 0 12px 0; }
  .letterhead td { border: none; vertical-align: middle; padding: 0; }
  .letterhead .seal { width: 76px; }
  .letterhead .seal-left { text-align: left; }
  .letterhead .seal-right { text-align: right; }
  .letterhead .header-text { text-align: center; padding: 0 12px; }
  .letterhead .gov { font-size: 8pt; }
  .letterhead .prov { font-size: 11pt; font-weight: bold; margin-top: 1px; }
  .letterhead .addr { font-size: 8pt; margin-top: 1px; }
  .letterhead .office { font-size: 9.5pt; font-weight: bold; text-decoration: underline; margin-top: 2px; }
  table.grid { width: 100%; border-collapse: collapse; }
  table.grid th, table.grid td { border: 1px solid #000; padding: 4px 5px; text-align: center; vertical-align: middle; font-size: 7.5pt; }
  table.grid th { background: #f0f0f0; font-size: 7pt; }
  td.left { text-align: left; }
  td.right { text-align: right; }
  .total-row { font-weight: bold; }
  table.form { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  table.form td { border: none; padding: 5px 4px; vertical-align: bottom; font-size: 10pt; }
  table.form td.lbl { width: 46%; white-space: nowrap; padding-right: 6px; }
  table.form td.colon { width: 12px; text-align: center; }
  table.form td.val { width: auto; border-bottom: 1px solid #000; min-height: 16px; padding-left: 4px; padding-bottom: 3px; }
  table.form tr.emphasis td.val { font-weight: bold; text-transform: uppercase; }
  .signatures { clear: both; margin-top: 32px; width: 100%; font-size: 8pt; display: flex; justify-content: space-between; gap: 12px; }
  .sig { flex: 1; text-align: center; vertical-align: top; }
  .sig-name { font-weight: bold; text-decoration: underline; margin-top: 30px; min-height: 1.2em; text-transform: uppercase; }
`;

function isSectionRow(row: WorkItemComputed): boolean {
  const itemNo = String(row.snapshotItemNo || row.itemNo || '').trim();
  const unit = String(row.snapshotUnit || row.unit || '').trim();
  const desc = String(row.snapshotDescription || row.description || '').trim();
  if (/^[IVXLCDM]+\.\s/i.test(desc) || /^[A-Z]\.\s+[A-Z]/.test(desc)) return true;
  return !itemNo && !unit && (row.unitPrice || 0) === 0 && (row.programmedQty || 0) === 0;
}

function qtyCell(value: number, blankZero = false): string {
  if (blankZero && (!value || Math.abs(value) < 1e-9)) return '';
  return formatPct(value);
}

function moneyCell(value: number, blankZero = false): string {
  if (blankZero && (!value || Math.abs(value) < 1e-9)) return '';
  return formatMoney(value);
}

function normalizeLineItems(raw: unknown): WorkItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      id: String(item.id ?? `row-${index}`),
      payItemId: item.payItemId != null ? String(item.payItemId) : undefined,
      payItemVersion: item.payItemVersion != null ? Number(item.payItemVersion) : undefined,
      snapshotItemNo: item.snapshotItemNo != null ? String(item.snapshotItemNo) : undefined,
      snapshotDescription:
        item.snapshotDescription != null ? String(item.snapshotDescription) : undefined,
      snapshotUnit: item.snapshotUnit != null ? String(item.snapshotUnit) : undefined,
      itemNo: String(item.itemNo ?? item.item_no ?? ''),
      description: String(item.description ?? ''),
      unit: String(item.unit ?? ''),
      unitPrice: Number(item.unitPrice ?? item.unit_price ?? 0) || 0,
      programmedQty: Number(item.programmedQty ?? item.programmed_qty ?? 0) || 0,
      revisedQty: Number(item.revisedQty ?? item.revised_qty ?? 0) || 0,
      previous: Number(item.previous ?? 0) || 0,
      thisPeriod: Number(item.thisPeriod ?? item.this_period ?? 0) || 0,
      remarks: String(item.remarks ?? item.status ?? ''),
    };
  });
}

function padRows<T extends Record<string, unknown>>(items: T[], min: number): T[] {
  const rows = [...items];
  while (rows.length < min) rows.push({} as T);
  return rows;
}

function linedListHtml(value: unknown): string {
  const lines = Array.isArray(value)
    ? value.map((line) => String(line ?? '').trim()).filter(Boolean)
    : String(value ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
  if (!lines.length) return '<p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p>';
  let html = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  while ((html.match(/<p>/g) || []).length < 3) html += '<p>&nbsp;</p>';
  return html;
}

function asRowArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === 'object') as Record<string, unknown>[];
}

function formRow(label: string, value: string, emphasis = false): string {
  return `<tr class="${emphasis ? 'emphasis' : ''}">
    <td class="lbl">${escapeHtml(label)}</td>
    <td class="colon">:</td>
    <td class="val">${value || '&nbsp;'}</td>
  </tr>`;
}

export function buildOfficialSwaHtml(
  report: Pick<SwaStewaReport, 'report_number' | 'report_data' | 'line_items' | 'project_name'>,
): string {
  const data = (report.report_data ?? {}) as Record<string, unknown>;
  const showRevised = truthyFlag(data.show_revised_quantity ?? data.showRevisedQuantity);
  const lessAmount = lessAmountOf(data);
  const { items, totals } = computeWorkItems(
    normalizeLineItems(report.line_items),
    lessAmount,
    showRevised,
  );

  const rows = items
    .map((row) => {
      const section = isSectionRow(row);
      let html = '<tr>';
      html += `<td>${escapeHtml(String(row.snapshotItemNo || row.itemNo || ''))}</td>`;
      html += `<td class="left">${escapeHtml(String(row.snapshotDescription || row.description || ''))}</td>`;
      html += `<td class="right">${qtyCell(row.programmedQty, section)}</td>`;
      html += `<td class="right">${moneyCell(row.unitPrice, section)}</td>`;
      html += `<td>${escapeHtml(String(row.snapshotUnit || row.unit || ''))}</td>`;
      html += `<td class="right">${moneyCell(row.contractAmount, section)}</td>`;
      html += `<td class="right">${qtyCell(row.weightPct, section)}</td>`;
      if (showRevised) {
        const rq = row.revisedQty ?? 0;
        html += `<td class="right">${rq > 0 ? formatPct(rq) : ''}</td>`;
        html += `<td class="right">${moneyCell(row.revisedAmount, true)}</td>`;
        html += `<td class="right">${qtyCell(row.revisedWeightPct, true)}</td>`;
      }
      html += `<td class="right">${qtyCell(row.previous, true)}</td>`;
      html += `<td class="right">${qtyCell(row.thisPeriod, section || row.thisPeriod === 0)}</td>`;
      html += `<td class="right">${qtyCell(row.toDate, section || row.toDate === 0)}</td>`;
      html += `<td class="right">${qtyCell(row.accomplishmentWeightPct, section)}</td>`;
      html += `<td>${escapeHtml(String(row.remarks || row.status || ''))}</td>`;
      html += '</tr>';
      return html;
    })
    .join('');

  const projectName = escapeHtml(
    String(data.project_name ?? data.project_title ?? report.project_name ?? ''),
  );
  const location = escapeHtml(String(data.location ?? ''));
  const lessReason = escapeHtml(lessReasonOf(data));

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
@page { size: 13in 8.5in; margin: 25px 30px 60px 30px; }
${SHARED_CSS}
body { font-size: 7pt; }
.summary { margin-top: 12px; float: right; width: 280px; font-size: 8pt; }
.summary td { border: none; padding: 2px 6px; }
.summary .label { text-align: left; }
.summary .val { text-align: right; font-weight: bold; }
</style></head><body>
<div class="report-no">${escapeHtml(report.report_number)}</div>
${letterheadHtml()}
<h3>STATEMENT OF WORK ACCOMPLISHMENT</h3>
<div class="meta">
  As of <u>${escapeHtml(formatReportDate(data.report_date))}</u><br>
  <strong>${projectName}</strong><br>
  ${location}
</div>
<table class="grid">
  <thead>
    <tr>
      <th rowspan="2">ITEM NO.</th>
      <th rowspan="2">DESCRIPTION OF WORK</th>
      <th rowspan="2">PROGRAMMED QUANTITY</th>
      <th rowspan="2">UNIT PRICE</th>
      <th rowspan="2">UNIT</th>
      <th rowspan="2">CONTRACT AMOUNT</th>
      <th rowspan="2">WEIGHT %</th>
      ${showRevised ? '<th colspan="3">REVISED</th>' : ''}
      <th colspan="3">ACCOMPLISHMENT</th>
      <th rowspan="2">WEIGHT %</th>
      <th rowspan="2">REMARKS/STATUS</th>
    </tr>
    <tr>
      ${showRevised ? '<th>QUANTITY</th><th>AMOUNT</th><th>WEIGHT %</th>' : ''}
      <th>PREVIOUS</th>
      <th>THIS PERIOD</th>
      <th>TO DATE</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
    <tr class="total-row">
      <td colspan="5">TOTAL</td>
      <td class="right">${formatMoney(totals.totalContractAmount)}</td>
      <td class="right">${formatPct(totals.totalWeightPct)}</td>
      ${
        showRevised
          ? `<td></td><td class="right">${formatMoney(totals.totalRevisedAmount)}</td><td class="right">${formatPct(totals.totalRevisedWeightPct)}</td>`
          : ''
      }
      <td colspan="3"></td>
      <td class="right">${formatPct(totals.totalToDateWeightPct)}</td>
      <td></td>
    </tr>
  </tbody>
</table>
<table class="summary">
  <tr><td class="label">% THIS ACCOMPLISHMENT</td><td class="val">${formatPct(totals.pctThisAccomplishment)}%</td></tr>
  <tr><td class="label">TOTAL PROJECT COST</td><td class="val">P ${formatMoney(totals.totalContractAmount)}</td></tr>
  <tr><td class="label">TOTAL THIS ACCOMPLISHMENT</td><td class="val">P ${formatMoney(totals.totalThisAccomplishment)}</td></tr>
  <tr><td class="label">LESS: ${lessReason}</td><td class="val">P ${formatMoney(lessAmount)}</td></tr>
  <tr><td class="label">TOTAL VOUCHER</td><td class="val">P ${formatMoney(totals.totalVoucher)}</td></tr>
</table>
<div class="signatures">
  <div class="sig"><div>Prepared by:</div><div class="sig-name">${escapeHtml(field(data, 'prepared_by_name'))}</div><div>${escapeHtml(field(data, 'prepared_by_title') || 'Engineer I')}</div></div>
  <div class="sig"><div>Checked by:</div><div class="sig-name">${escapeHtml(field(data, 'checked_by_name'))}</div><div>${escapeHtml(field(data, 'checked_by_title') || 'Chief of Construction Division')}</div></div>
  <div class="sig"><div>Recommending Approval:</div><div class="sig-name">${escapeHtml(field(data, 'recommending_name'))}</div><div>${escapeHtml(field(data, 'recommending_title') || 'Provincial Engineer')}</div></div>
  <div class="sig"><div>Approved:</div><div class="sig-name">${escapeHtml(field(data, 'approved_by_name'))}</div><div>${escapeHtml(field(data, 'approved_by_title') || 'Governor')}</div></div>
</div>
</body></html>`;
}

export function buildOfficialStewaHtml(
  report: Pick<SwaStewaReport, 'report_number' | 'report_data' | 'project_name'>,
): string {
  const data = (report.report_data ?? {}) as Record<string, unknown>;
  const projectName = escapeHtml(
    field(data, 'project_name', 'project_title') || report.project_name || '',
  );

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
@page { size: 8.5in 13in; margin: 32px 42px 44px 42px; }
${SHARED_CSS}
body { font-size: 10pt; max-width: 780px; margin: 0 auto; }
table.form td.lbl { width: 52%; white-space: normal; }
table.sig-table { width: 100%; border-collapse: collapse; margin-top: 36px; }
table.sig-table td { width: 50%; text-align: center; vertical-align: top; border: none; padding: 8px 16px; font-size: 9.5pt; }
</style></head><body>
<div class="report-no">${escapeHtml(report.report_number)}</div>
${letterheadHtml()}
<div class="doc-title">STATEMENT OF TIME ELAPSED AND WORK ACCOMPLISHED</div>
<div class="meta">As of <u>${escapeHtml(formatReportDate(data.report_date))}</u></div>

<table class="form">
  ${formRow('Project Name', projectName, true)}
  ${formRow('Location', escapeHtml(field(data, 'location')))}
  ${formRow('Contract Amount', moneyField(data, 'contract_amount'))}
  ${formRow('Contractor', escapeHtml(field(data, 'contractor')))}
</table>

<table class="form">
  ${formRow('1. Period Covered', escapeHtml(field(data, 'period_covered')))}
  ${formRow('2. Contract Duration', escapeHtml(field(data, 'contract_duration')))}
  ${formRow('3. Date of Receipt of Notice to Proceed', escapeHtml(formatReportDate(data.notice_to_proceed, true)))}
  ${formRow('4. Expiry Date', escapeHtml(formatReportDate(data.expiry_date, true)))}
  ${formRow('5. Approved Time Extension', escapeHtml(field(data, 'approved_time_extension') || '-'))}
  ${formRow('6. Approved Time Suspension', escapeHtml(field(data, 'approved_time_suspension') || '-'))}
  ${formRow('7. Total Time Extension', escapeHtml(field(data, 'total_time_extension')))}
  ${formRow('8. Revised Contract Duration', escapeHtml(field(data, 'revised_contract_duration')))}
  ${formRow('9. Revised Expiry Date', escapeHtml(formatReportDate(data.revised_expiry_date, true)))}
  ${formRow('10. Total Calendar days Elapsed to Date', escapeHtml(field(data, 'calendar_days_elapsed')))}
  ${formRow('11. Percentage of work accomplished - Actual', `${escapeHtml(field(data, 'percent_actual') || '0.00')}%`)}
  ${formRow('12. Percentage of work accomplished - Planned', `${escapeHtml(field(data, 'percent_planned') || '0.00')}%`)}
  ${formRow('13. Slippage', `${escapeHtml(field(data, 'slippage') || '0.00')}%`)}
  ${formRow('14. Remarks', escapeHtml(field(data, 'remarks')))}
</table>

<table class="sig-table">
  <tr>
    <td>
      <div>Submitted by:</div>
      <div class="sig-name">${escapeHtml(field(data, 'submitted_by_name', 'prepared_by_name'))}</div>
      <div>${escapeHtml(field(data, 'submitted_by_title', 'prepared_by_title') || 'Engineer II')}</div>
    </td>
    <td>
      <div>Noted by:</div>
      <div class="sig-name">${escapeHtml(field(data, 'noted_by_name', 'checked_by_name'))}</div>
      <div>${escapeHtml(field(data, 'noted_by_title', 'checked_by_title') || 'Engineer IV (Chief-Construction Division)')}</div>
    </td>
  </tr>
</table>
</body></html>`;
}

export function buildOfficialIarHtml(
  report: Pick<SwaStewaReport, 'report_number' | 'report_data' | 'project_name'>,
): string {
  const data = (report.report_data ?? {}) as Record<string, unknown>;
  const accomplishment = padRows(asRowArray(data.accomplishment_items), 10);
  const variation = padRows(asRowArray(data.variation_items), 4);
  const manpower = padRows(asRowArray(data.manpower), 4);
  const equipment = padRows(asRowArray(data.equipment), 4);

  const accomplishmentRows = accomplishment
    .map((item) => {
      const itemNo = escapeHtml(String(item.item_no ?? item.itemNo ?? ''));
      const desc = escapeHtml(String(item.description ?? ''));
      const location = escapeHtml(String(item.location ?? ''));
      const physical = escapeHtml(String(item.physical_qty ?? item.physicalQty ?? ''));
      const billable = escapeHtml(String(item.billable_qty ?? item.billableQty ?? ''));
      const unit = escapeHtml(String(item.unit ?? ''));
      return `<tr><td>${itemNo}</td><td class="left">${desc}</td><td>${location}</td><td class="right">${physical}</td><td class="right">${billable}</td><td>${unit}</td></tr>`;
    })
    .join('');

  const variationRows = variation
    .map((item) => {
      const itemNo = escapeHtml(String(item.item_no ?? item.itemNo ?? ''));
      const desc = escapeHtml(String(item.description ?? ''));
      const qty = escapeHtml(String(item.quantity ?? ''));
      const unit = escapeHtml(String(item.unit ?? ''));
      const additive = escapeHtml(String(item.additive ?? ''));
      const deductive = escapeHtml(String(item.deductive ?? ''));
      const newItem = escapeHtml(String(item.new_item ?? item.newItem ?? ''));
      return `<tr><td>${itemNo}</td><td class="left">${desc}</td><td class="right">${qty}</td><td>${unit}</td><td>${additive}</td><td>${deductive}</td><td>${newItem}</td></tr>`;
    })
    .join('');

  const resourceRows = (rows: Record<string, unknown>[]) =>
    rows
      .map((row) => {
        const desc = escapeHtml(String(row.description ?? ''));
        const qty = escapeHtml(String(row.quantity ?? ''));
        return `<tr><td class="left">${desc}</td><td class="right">${qty}</td></tr>`;
      })
      .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
@page { size: 8.5in 13in; margin: 0.35in 0.4in 0.4in 0.4in; }
${SHARED_CSS}
body { font-size: 7.5pt; }
.section-lbl { font-weight: bold; font-size: 7.5pt; margin: 8px 0 2px; text-transform: uppercase; }
.two-col { width: 100%; border-collapse: collapse; margin-top: 4px; }
.two-col > tbody > tr > td { width: 50%; vertical-align: top; padding: 0 4px 0 0; border: none; }
.two-col > tbody > tr > td + td { padding: 0 0 0 4px; }
.lined-box, .problems-box { border: 1px solid #000; min-height: 40px; padding: 2px 4px; font-size: 7pt; }
.lined-box p { margin: 0 0 6px; border-bottom: 1px solid #ccc; min-height: 10px; }
.meta-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 7.5pt; }
.meta-table td { padding: 3px 4px; vertical-align: bottom; border: none; }
.meta-table .lbl { font-weight: bold; white-space: nowrap; width: 1%; }
.meta-table .val { border-bottom: 1px solid #000; }
</style></head><body>
<div class="report-no">${escapeHtml(report.report_number)}</div>
${letterheadHtml()}
<div class="doc-title">INSPECTION ACCOMPLISHMENT REPORT</div>
<table class="meta-table">
  <tr>
    <td class="lbl">Contract No.:</td><td class="val">${escapeHtml(field(data, 'contract_number'))}</td>
    <td class="lbl">Municipality:</td><td class="val">${escapeHtml(field(data, 'municipality'))}</td>
  </tr>
  <tr>
    <td class="lbl">Project Title:</td>
    <td class="val" colspan="3">${escapeHtml(field(data, 'project_title', 'project_name') || report.project_name || '')}</td>
  </tr>
  <tr>
    <td class="lbl">Contractor:</td><td class="val">${escapeHtml(field(data, 'contractor'))}</td>
    <td class="lbl">Week Covered:</td><td class="val">${escapeHtml(field(data, 'week_covered', 'period_covered'))}</td>
  </tr>
</table>
<table class="grid">
  <thead>
    <tr>
      <th rowspan="2">Item No.</th>
      <th rowspan="2">Description</th>
      <th rowspan="2">Location / Station</th>
      <th colspan="2">Quantity for the week</th>
      <th rowspan="2">Unit</th>
    </tr>
    <tr><th>Physical</th><th>Billable</th></tr>
  </thead>
  <tbody>${accomplishmentRows}</tbody>
</table>
<div class="section-lbl">For variation order</div>
<table class="grid">
  <thead>
    <tr>
      <th>Item No.</th><th>Description</th><th>Quantity</th><th>Unit</th>
      <th>Additive</th><th>Deductive</th><th>New Item</th>
    </tr>
  </thead>
  <tbody>${variationRows}</tbody>
</table>
<table class="two-col">
  <tr>
    <td><div class="section-lbl">Activities for the week:</div><div class="lined-box">${linedListHtml(data.activities)}</div></td>
    <td><div class="section-lbl">Field instructions:</div><div class="lined-box">${linedListHtml(data.field_instructions)}</div></td>
  </tr>
</table>
<table class="two-col">
  <tr>
    <td>
      <div class="section-lbl">Problems encountered / remarks:</div>
      <div class="problems-box">${escapeHtml(field(data, 'problems_remarks', 'remarks')).replace(/\n/g, '<br>')}</div>
    </td>
    <td>
      <div class="section-lbl" style="text-align:center">Manpower</div>
      <table class="grid"><thead><tr><th>Description</th><th>Quantity</th></tr></thead><tbody>${resourceRows(manpower)}</tbody></table>
      <div class="section-lbl" style="text-align:center">Equipment</div>
      <table class="grid"><thead><tr><th>Description</th><th>Quantity</th></tr></thead><tbody>${resourceRows(equipment)}</tbody></table>
    </td>
  </tr>
</table>
<div class="section-lbl">Weekly physical accomplishment percentage (cumulative):</div>
<table class="grid">
  <thead><tr><th>Orig. Target</th><th>Rev. Target</th><th>Actual</th><th>Variance</th><th>Remarks</th></tr></thead>
  <tbody>
    <tr>
      <td>${escapeHtml(field(data, 'orig_target'))}</td>
      <td>${escapeHtml(field(data, 'rev_target'))}</td>
      <td>${escapeHtml(field(data, 'actual_progress', 'percent_complete'))}</td>
      <td>${escapeHtml(field(data, 'variance'))}</td>
      <td class="left">${escapeHtml(field(data, 'progress_remarks'))}</td>
    </tr>
  </tbody>
</table>
<div class="signatures">
  <div class="sig"><div>Prepared by:</div><div class="sig-name">${escapeHtml(field(data, 'prepared_by_name'))}</div><div>PEO Engineer I</div></div>
  <div class="sig"><div>Checked by:</div><div class="sig-name">${escapeHtml(field(data, 'checked_by_name'))}</div><div>PEO Engineer II</div></div>
  <div class="sig"><div>Noted by:</div><div class="sig-name">${escapeHtml(field(data, 'noted_by_name'))}</div><div>PEO Engineer III</div></div>
  <div class="sig"><div>Conforme:</div><div class="sig-name">${escapeHtml(field(data, 'contractor_representative'))}</div><div>Contractor's Representative</div></div>
</div>
</body></html>`;
}

/** Official print layout for SWA / STEWA / IAR (no QR). */
export function buildOfficialReportHtml(report: SwaStewaReport): string {
  if (report.report_type === 'SWA') return buildOfficialSwaHtml(report);
  if (report.report_type === 'STEWA') return buildOfficialStewaHtml(report);
  if (report.report_type === 'IAR') return buildOfficialIarHtml(report);
  return '';
}
