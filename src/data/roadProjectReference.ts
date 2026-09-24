import type { WorkItem } from '../lib/workItems';
import { REFERENCE_PDM_TITLE } from './roadPdmSample';

export const REFERENCE_LOCATION = 'Remebella, Buguey, Cagayan';
export const REFERENCE_CONTRACTOR = 'Reyrose Construction';
export const REFERENCE_CONTRACT_AMOUNT = 5991119.01;
export const REFERENCE_START_DATE = '2025-07-01';
export const REFERENCE_DURATION_DAYS = 110;

export interface ReferenceBoqRow {
  pdmKey: string;
  itemNo: string;
  description: string;
  unit: string;
  qty: number;
  unitCost: number;
  amount: number;
  weightPct: number;
}

/** Bill of quantities from Reyrose Construction target plan (20 items). */
export const REFERENCE_BOQ: ReferenceBoqRow[] = [
  { pdmKey: 'a111', itemNo: 'A.1.1(11)', description: 'Provision of Furnitures/Fixtures, etc. for the Field Office for the Engineer', unit: 'L.S.', qty: 1, unitCost: 118125, amount: 118125, weightPct: 1.972 },
  { pdmKey: 'b5', itemNo: 'B.5', description: 'Project Billboard', unit: 'each', qty: 2, unitCost: 5055.28, amount: 10110.56, weightPct: 0.169 },
  { pdmKey: 'b7', itemNo: 'B.7', description: 'Construction Safety & Health Program', unit: 'L.S.', qty: 1, unitCost: 44176.86, amount: 44176.86, weightPct: 0.737 },
  { pdmKey: 'b9', itemNo: 'B.9', description: 'Mobilization / Demobilization', unit: 'L.S.', qty: 1, unitCost: 42997.5, amount: 42997.5, weightPct: 0.718 },
  { pdmKey: 'r1013', itemNo: '101(3)b3', description: 'Removal of Actual Structures/Obstructions, 0.23m thk. PCCP (Unreinforced)', unit: 'sq.m.', qty: 11.25, unitCost: 1021.47, amount: 11491.54, weightPct: 0.192 },
  { pdmKey: 'r1014', itemNo: '101(4)a1', description: 'Removal of Actual Structures/Obstructions, 610mm dia. RCPC', unit: 'ln.m.', qty: 7, unitCost: 2080.55, amount: 14563.85, weightPct: 0.243 },
  { pdmKey: 'e1041', itemNo: '104(1)a', description: 'Embankment from Roadway Excavation (Common Soil)', unit: 'cu.m.', qty: 269.48, unitCost: 632.98, amount: 170582.79, weightPct: 2.847 },
  { pdmKey: 'e1042', itemNo: '104(2)a', description: 'Embankment (From Borrow, Common Soil)', unit: 'cu.m.', qty: 147.96, unitCost: 1098.72, amount: 162568.61, weightPct: 2.713 },
  { pdmKey: 'e103', itemNo: '103(1)a', description: 'Structure Excavation (Common Soil)', unit: 'cu.m.', qty: 230.87, unitCost: 611.08, amount: 141080.04, weightPct: 2.355 },
  { pdmKey: 'e105', itemNo: '105(1)', description: 'Sub-Grade Preparation (Common Material)', unit: 'sq.m.', qty: 2035, unitCost: 34.29, amount: 69817.18, weightPct: 1.165 },
  { pdmKey: 'e200', itemNo: '200(1)', description: 'Aggregate Sub-Base Course', unit: 'cu.m.', qty: 564.54, unitCost: 1075.64, amount: 607236.64, weightPct: 10.136 },
  { pdmKey: 'p311u', itemNo: '311(1)c1', description: 'Portland Cement Concrete Pavement (Unreinforced), 0.23m thk. 14 days', unit: 'sq.m.', qty: 1695.73, unitCost: 1522.4, amount: 2581540.76, weightPct: 43.089 },
  { pdmKey: 'p311r', itemNo: '311(2)e1', description: 'Portland Cement Concrete Pavement (Reinforced), 0.28m thk. 14 days', unit: 'sq.m.', qty: 23, unitCost: 2439.64, amount: 56111.72, weightPct: 0.937 },
  { pdmKey: 'r404a', itemNo: '404(1)a', description: 'Reinforcing Steel, Grade 40 (ø10mm)', unit: 'kg', qty: 19.1, unitCost: 108.88, amount: 2079.61, weightPct: 0.035 },
  { pdmKey: 'r404b', itemNo: '404(1)b', description: 'Reinforcing Steel, Grade 60 (ø12mm)', unit: 'kg', qty: 38.92, unitCost: 84.17, amount: 3275.9, weightPct: 0.055 },
  { pdmKey: 'r405c', itemNo: '405(1)a3', description: 'Structural Concrete Class A, 20.68MPa @ 28 days (culvert)', unit: 'cu.m.', qty: 3.25, unitCost: 6879.28, amount: 22357.66, weightPct: 0.373 },
  { pdmKey: 'r500', itemNo: '500(1)a3', description: 'Reinforced Concrete Pipe Culvert, 910mm dia. Class IV', unit: 'ln.m.', qty: 19, unitCost: 5036.99, amount: 95702.81, weightPct: 1.597 },
  { pdmKey: 'r404a2', itemNo: '404(1)a', description: 'Reinforcing Steel, Grade 40 (Retaining Wall)', unit: 'kg', qty: 5739.87, unitCost: 72.19, amount: 414361.22, weightPct: 6.916 },
  { pdmKey: 'r404b2', itemNo: '404(1)b', description: 'Reinforcing Steel, Grade 60 (Retaining Wall)', unit: 'kg', qty: 5306.46, unitCost: 68.71, amount: 364606.87, weightPct: 6.086 },
  { pdmKey: 'r405p', itemNo: '405(1)a3', description: 'Structural Concrete Class A, 20.68MPa @ 28 days (Retaining Wall)', unit: 'cu.m.', qty: 170.74, unitCost: 6198.63, amount: 1058354.09, weightPct: 17.665 },
];

/** Contractor target cumulative % at end of each 10-day period (days 90–110 interpolated). */
export const REFERENCE_TARGET_CUMULATIVE: Record<number, number> = {
  10: 2.925,
  20: 4.279,
  30: 9.418,
  40: 13.912,
  50: 18.933,
  60: 23.621,
  70: 31.873,
  80: 44.585,
  90: 62,
  100: 82,
  110: 100,
};

export function isReferenceProject(name: string | undefined | null): boolean {
  if (!name) return false;
  return (
    name.includes('Remebella') ||
    name.includes('CATO-CONNER') ||
    name.includes(REFERENCE_PDM_TITLE.slice(0, 24))
  );
}

export function buildReferenceWorkItems(): WorkItem[] {
  return REFERENCE_BOQ.map((row, i) => ({
    id: `ref-${i + 1}`,
    itemNo: row.itemNo,
    description: row.description,
    unit: row.unit,
    unitPrice: row.unitCost,
    programmedQty: row.qty,
    previous: 0,
    thisPeriod: 0,
    remarks: '',
  }));
}

export function referenceProjectMeta() {
  const start = new Date(REFERENCE_START_DATE);
  const end = new Date(start);
  end.setDate(end.getDate() + REFERENCE_DURATION_DAYS);
  return {
    project_name: REFERENCE_PDM_TITLE,
    location: REFERENCE_LOCATION,
    contractor: REFERENCE_CONTRACTOR,
    contract_amount: String(REFERENCE_CONTRACT_AMOUNT),
    start_date: REFERENCE_START_DATE,
    planned_end_date: end.toISOString().slice(0, 10),
  };
}
