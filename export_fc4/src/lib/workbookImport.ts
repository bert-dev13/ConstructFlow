import * as XLSX from 'xlsx';
import { normalizePayItemNo } from './firebase/payItems';

export interface WorkbookPayItemRow {
  itemNo: string;
  description: string;
  unit: string;
  programmedQty: number;
  unitPrice: number;
  contractAmount: number;
  sourceSheet: string;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(/[,₱\s]/g, ''));
  return Number.isFinite(parsed) && String(value ?? '').trim() !== '' ? parsed : null;
}

function isSwaSheet(name: string): boolean {
  return /^swa\b/i.test(name.trim());
}

export function parseSwaWorkbook(buffer: ArrayBuffer): WorkbookPayItemRow[] {
  const workbook = XLSX.read(buffer, { type: 'array', cellFormula: true });
  const byItemNo = new Map<string, WorkbookPayItemRow>();

  for (const sheetName of workbook.SheetNames.filter(isSwaSheet)) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });

    for (const row of rows) {
      const itemNo = String(row[0] ?? '').trim();
      const description = String(row[1] ?? '').trim();
      const unit = String(row[4] ?? '').trim();
      const programmedQty = numberValue(row[3]);
      const unitPrice = numberValue(row[5]);

      // Section headings have no programmed quantity, unit, or unit price.
      if (!itemNo || !description || !unit || programmedQty == null || unitPrice == null) continue;

      const normalizedItemNo = normalizePayItemNo(itemNo);
      if (!normalizedItemNo) continue;
      const parsed: WorkbookPayItemRow = {
        itemNo,
        description,
        unit,
        programmedQty,
        unitPrice,
        contractAmount: programmedQty * unitPrice,
        sourceSheet: sheetName,
      };
      const previous = byItemNo.get(normalizedItemNo);
      if (!previous || /final/i.test(sheetName)) byItemNo.set(normalizedItemNo, parsed);
    }
  }

  return [...byItemNo.values()].sort((a, b) =>
    a.itemNo.localeCompare(b.itemNo, undefined, { numeric: true }),
  );
}
