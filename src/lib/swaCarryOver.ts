import type { IarAccomplishmentItem, IarManpowerRow, IarVariationItem } from './iarItems';
import { isSwaSectionRow, type WorkItem } from './workItems';

export type ReportCarryType = 'SWA' | 'STEWA' | 'IAR';

/** Contract fields that stay with the project from one STEWA to the next. */
export const STEWA_CARRY_FIELDS = [
  'contract_duration',
  'notice_to_proceed',
  'approved_time_extension',
  'approved_time_suspension',
] as const;

/** A saved report, narrowed to the fields carry-over reads. */
export type ReportCarrySource = {
  id: string;
  project_id: string | number;
  report_type: string;
  report_number?: string;
  created_at?: string;
  report_data?: Record<string, unknown> | null;
  line_items?: Array<WorkItem & { toDate?: number }> | null;
};

export type CarriedReport = {
  projectId: string;
  reportNumber: string;
  lineItems: WorkItem[] | null;
  iarItems: IarAccomplishmentItem[] | null;
  variationItems: IarVariationItem[] | null;
  manpower: IarManpowerRow[] | null;
  equipment: IarManpowerRow[] | null;
  dataPatch: Record<string, string>;
};

type Row = Record<string, unknown>;

function text(row: Row, ...keys: string[]): string {
  for (const key of keys) {
    const value = String(row[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function rowKey(row: Row): string {
  const itemNo = text(row, 'itemNo', 'item_no', 'snapshotItemNo').toLowerCase();
  if (itemNo) return `no:${itemNo}`;
  const payItemId = text(row, 'payItemId');
  if (payItemId) return `pay:${payItemId}`;
  const description = text(row, 'description', 'snapshotDescription').toLowerCase();
  if (description) return `desc:${description}`;
  return '';
}

function deduped(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const items: Row[] = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(row);
  }
  return items;
}

function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === 'object') as Row[];
}

function newId(): string {
  return crypto.randomUUID();
}

/** Cumulative amount already accomplished on the source SWA. */
export function swaCarriedToDate(item: WorkItem & { toDate?: number }): number {
  if (item.toDateInput != null && Number.isFinite(Number(item.toDateInput))) {
    return Number(item.toDateInput);
  }
  if (item.toDate != null && Number.isFinite(Number(item.toDate))) {
    return Number(item.toDate);
  }
  return (Number(item.previous) || 0) + (Number(item.thisPeriod) || 0);
}

/**
 * SWA items for the next period. Identity stays. This Period starts at zero.
 * Previous and To Date start at the source To Date. Duplicate item numbers are kept once.
 */
export function carrySwaLineItems(source: Array<WorkItem & { toDate?: number }> | null | undefined): WorkItem[] {
  const items: WorkItem[] = [];
  for (const item of deduped((source ?? []) as unknown as Row[])) {
    const toDate = swaCarriedToDate(item as unknown as WorkItem & { toDate?: number });
    items.push({
      id: newId(),
      payItemId: text(item, 'payItemId'),
      payItemVersion: item.payItemVersion != null ? Number(item.payItemVersion) : undefined,
      snapshotItemNo: text(item, 'snapshotItemNo', 'itemNo', 'item_no'),
      snapshotDescription: text(item, 'snapshotDescription', 'description'),
      snapshotUnit: text(item, 'snapshotUnit', 'unit'),
      itemNo: text(item, 'itemNo', 'item_no', 'snapshotItemNo'),
      description: text(item, 'description', 'snapshotDescription'),
      unit: text(item, 'unit', 'snapshotUnit'),
      unitPrice: Number(item.unitPrice) || 0,
      programmedQty: Number(item.programmedQty) || 0,
      revisedQty: Number(item.revisedQty) || 0,
      previous: toDate,
      thisPeriod: 0,
      toDateInput: toDate,
      remarks: '',
    });
  }
  return items;
}

/** First IAR for a project: use the SWA item list, with this week's quantities left blank. */
export function accomplishmentItemsFromSwa(
  source: Array<WorkItem & { toDate?: number }> | null | undefined,
): IarAccomplishmentItem[] {
  const rows = (source ?? []).filter((item) => !isSwaSectionRow(item));
  return carryIarItems(rows as unknown as Row[]);
}

function carryIarItems(rows: Row[]): IarAccomplishmentItem[] {
  return deduped(rows).map((item) => {
    const itemNo = text(item, 'itemNo', 'item_no', 'snapshotItemNo');
    return {
      id: newId(),
      payItemId: text(item, 'payItemId'),
      payItemVersion: item.payItemVersion != null ? Number(item.payItemVersion) : undefined,
      snapshotItemNo: text(item, 'snapshotItemNo', 'itemNo', 'item_no'),
      snapshotDescription: text(item, 'snapshotDescription', 'description'),
      snapshotUnit: text(item, 'snapshotUnit', 'unit'),
      itemNo,
      description: text(item, 'description', 'snapshotDescription'),
      location: text(item, 'location'),
      physicalQty: '',
      billableQty: '',
      unit: text(item, 'unit', 'snapshotUnit'),
    };
  });
}

function carryVariationItems(rows: Row[]): IarVariationItem[] {
  return deduped(rows).map((item) => {
    const itemNo = text(item, 'itemNo', 'item_no', 'snapshotItemNo');
    return {
      id: newId(),
      payItemId: text(item, 'payItemId'),
      payItemVersion: item.payItemVersion != null ? Number(item.payItemVersion) : undefined,
      snapshotItemNo: text(item, 'snapshotItemNo', 'itemNo', 'item_no'),
      snapshotDescription: text(item, 'snapshotDescription', 'description'),
      snapshotUnit: text(item, 'snapshotUnit', 'unit'),
      itemNo,
      description: text(item, 'description', 'snapshotDescription'),
      quantity: (item.quantity ?? '') as number | '',
      unit: text(item, 'unit', 'snapshotUnit'),
      additive: text(item, 'additive'),
      deductive: text(item, 'deductive'),
      newItem: text(item, 'newItem', 'new_item'),
    };
  });
}

function carryResourceRows(rows: Row[]): IarManpowerRow[] {
  return deduped(rows).map((item) => ({
    id: newId(),
    description: text(item, 'description'),
    quantity: '',
  }));
}

function stewaPatch(data: Record<string, unknown> | null | undefined): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const key of STEWA_CARRY_FIELDS) {
    const value = String(data?.[key] ?? '').trim();
    if (value) patch[key] = value;
  }
  return patch;
}

/** Bring the previous report's reusable items into a new report of the same type. */
export function carryReport(source: ReportCarrySource): CarriedReport | null {
  const type = source.report_type;
  const data = source.report_data ?? {};
  const carried: CarriedReport = {
    projectId: String(source.project_id || ''),
    reportNumber: source.report_number || '',
    lineItems: null,
    iarItems: null,
    variationItems: null,
    manpower: null,
    equipment: null,
    dataPatch: {},
  };

  if (type === 'SWA') {
    const lineItems = carrySwaLineItems(source.line_items);
    if (!lineItems.length) return null;
    carried.lineItems = lineItems;
    const revised = String(data.show_revised_quantity ?? '').trim();
    if (revised) carried.dataPatch.show_revised_quantity = revised;
    return carried;
  }

  if (type === 'IAR') {
    const iarItems = carryIarItems(asRows(data.accomplishment_items));
    const variationItems = carryVariationItems(asRows(data.variation_items));
    const manpower = carryResourceRows(asRows(data.manpower));
    const equipment = carryResourceRows(asRows(data.equipment));
    if (!iarItems.length && !variationItems.length && !manpower.length && !equipment.length) return null;
    carried.iarItems = iarItems.length ? iarItems : null;
    carried.variationItems = variationItems.length ? variationItems : null;
    carried.manpower = manpower.length ? manpower : null;
    carried.equipment = equipment.length ? equipment : null;
    return carried;
  }

  if (type === 'STEWA') {
    const dataPatch = stewaPatch(data);
    if (!Object.keys(dataPatch).length) return null;
    carried.dataPatch = dataPatch;
    return carried;
  }

  return null;
}

function reportMoment(report: ReportCarrySource): string {
  const asOf = String(report.report_data?.report_date ?? '').trim();
  const created = String(report.created_at ?? '').trim();
  return `${asOf}|${created}`;
}

/** Newest report of this type for the project that still has something to bring forward. */
export function latestReportForProject(
  reports: ReportCarrySource[],
  projectId: string,
  reportType: ReportCarryType,
  excludeId?: string,
): ReportCarrySource | null {
  const id = String(projectId || '').trim();
  if (!id) return null;
  const matches = reports
    .filter((report) => {
      if (report.report_type !== reportType) return false;
      if (String(report.project_id) !== id) return false;
      if (excludeId && String(report.id) === String(excludeId)) return false;
      return carryReport(report) != null;
    })
    .sort((a, b) => reportMoment(b).localeCompare(reportMoment(a)));
  return matches[0] ?? null;
}

/** @deprecated Use latestReportForProject(..., 'SWA'). */
export function latestSwaForProject(
  reports: ReportCarrySource[],
  projectId: string,
  excludeId?: string,
): ReportCarrySource | null {
  return latestReportForProject(reports, projectId, 'SWA', excludeId);
}
